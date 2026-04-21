import asyncio
import logging
from typing import AsyncIterator, Literal
from config import get_config, persist_provider_api_key, persist_setting

logger = logging.getLogger(__name__)
Provider = Literal["ollama", "openai", "anthropic", "gemini", "openrouter"]

class ModelRouter:
    def __init__(self):
        cfg = get_config()
        self.provider: Provider = cfg.LLM_PROVIDER
        self.model: str = cfg.LLM_MODEL
        self.api_key: str = cfg.get_api_key(self.provider)
        self.ollama_url: str = cfg.OLLAMA_BASE_URL
        # Cached clients so we reuse HTTP connections across requests
        self._ollama_client = None
        self._openai_client = None
        self._anthropic_client = None
        self._openrouter_client = None

    def _reset_clients(self):
        """Invalidate cached clients when credentials change."""
        self._ollama_client = None
        self._openai_client = None
        self._anthropic_client = None
        self._openrouter_client = None

    def update(self, provider: Provider, model: str, api_key: str | None = None):
        cfg = get_config()
        persist_setting("LLM_PROVIDER", provider)
        persist_setting("LLM_MODEL", model)
        cfg.LLM_PROVIDER = provider
        cfg.LLM_MODEL = model

        if api_key is not None:
            persist_provider_api_key(provider, api_key)
            env_key = f"{provider.upper()}_API_KEY"
            if hasattr(cfg, env_key):
                setattr(cfg, env_key, api_key)
            if provider != "ollama":
                persist_setting("API_KEY", "")
                cfg.API_KEY = ""

        self.provider = provider
        self.model = model
        self.api_key = cfg.get_api_key(provider)
        self._reset_clients()
        logger.info(f"Model router updated: {provider}/{model}")

    async def generate(self, prompt: str, stream: bool = True) -> AsyncIterator[str]:
        generators = {
            "ollama": self._ollama,
            "openai": self._openai,
            "anthropic": self._anthropic,
            "gemini": self._gemini,
            "openrouter": self._openrouter,
        }
        gen = generators.get(self.provider)
        if not gen:
            raise ValueError(f"Unknown provider: {self.provider}")
        async for token in gen(prompt, stream):
            yield token

    async def _ollama(self, prompt: str, stream: bool) -> AsyncIterator[str]:
        import ollama
        if self._ollama_client is None:
            self._ollama_client = ollama.AsyncClient(host=self.ollama_url)
        options = {"temperature": 0.3, "num_predict": 3000}
        if stream:
            async for chunk in await self._ollama_client.generate(
                model=self.model, prompt=prompt, stream=True, options=options
            ):
                text = chunk.get("response") if isinstance(chunk, dict) else getattr(chunk, "response", "")
                if text:
                    yield text
        else:
            result = await self._ollama_client.generate(model=self.model, prompt=prompt, options=options)
            text = result.get("response") if isinstance(result, dict) else getattr(result, "response", "")
            yield text or ""

    async def _openai(self, prompt: str, stream: bool) -> AsyncIterator[str]:
        if not self.api_key:
            raise ValueError("OpenAI API key is not set. Add it in Settings.")
        from openai import AsyncOpenAI
        if self._openai_client is None:
            self._openai_client = AsyncOpenAI(api_key=self.api_key)
        if stream:
            async with self._openai_client.chat.completions.stream(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3, max_tokens=3000
            ) as s:
                async for token in self._yield_openai_stream_tokens(s):
                    yield token
        else:
            resp = await self._openai_client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3, max_tokens=3000
            )
            yield resp.choices[0].message.content

    async def _anthropic(self, prompt: str, stream: bool) -> AsyncIterator[str]:
        if not self.api_key:
            raise ValueError("Anthropic API key is not set. Add it in Settings.")
        import anthropic
        if self._anthropic_client is None:
            self._anthropic_client = anthropic.AsyncAnthropic(api_key=self.api_key)
        if stream:
            async with self._anthropic_client.messages.stream(
                model=self.model, max_tokens=3000,
                messages=[{"role": "user", "content": prompt}]
            ) as s:
                async for text in s.text_stream:
                    yield text
        else:
            resp = await self._anthropic_client.messages.create(
                model=self.model, max_tokens=3000,
                messages=[{"role": "user", "content": prompt}]
            )
            yield resp.content[0].text

    async def _openrouter(self, prompt: str, stream: bool) -> AsyncIterator[str]:
        if not self.api_key:
            raise ValueError("OpenRouter API key is not set. Add it in Settings.")
        from openai import AsyncOpenAI
        if self._openrouter_client is None:
            self._openrouter_client = AsyncOpenAI(
                api_key=self.api_key,
                base_url="https://openrouter.ai/api/v1",
                default_headers={"HTTP-Referer": "http://localhost:3000", "X-Title": "superaXiom"},
            )
        params = dict(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=3000,
            frequency_penalty=0.1,
        )
        if stream:
            raw_stream = await self._openrouter_client.chat.completions.create(**params, stream=True)
            async for chunk in raw_stream:
                choices = getattr(chunk, "choices", None)
                if not choices:
                    continue
                choice = choices[0]
                finish_reason = getattr(choice, "finish_reason", None)
                if finish_reason:
                    break
                delta = getattr(choice, "delta", None)
                if delta is None:
                    continue
                content = getattr(delta, "content", None)
                if content:
                    yield content
        else:
            resp = await self._openrouter_client.chat.completions.create(**params)
            yield resp.choices[0].message.content

    async def _anthropic(self, prompt: str, stream: bool) -> AsyncIterator[str]:
        if not self.api_key:
            raise ValueError("Anthropic API key is not set. Add it in Settings.")
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=self.api_key)
        if stream:
            async with client.messages.stream(
                model=self.model, max_tokens=3000,
                messages=[{"role": "user", "content": prompt}]
            ) as s:
                async for text in s.text_stream:
                    yield text
        else:
            resp = await client.messages.create(
                model=self.model, max_tokens=3000,
                messages=[{"role": "user", "content": prompt}]
            )
            yield resp.content[0].text

    async def _gemini(self, prompt: str, stream: bool) -> AsyncIterator[str]:
        if not self.api_key:
            raise ValueError("Gemini API key is not set. Add it in Settings.")
        import google.generativeai as genai
        genai.configure(api_key=self.api_key)
        model = genai.GenerativeModel(self.model)
        loop = asyncio.get_event_loop()
        if stream:
            response = await loop.run_in_executor(
                None, lambda: model.generate_content(prompt, stream=True)
            )
            for chunk in response:
                if chunk.text:
                    yield chunk.text
        else:
            result = await loop.run_in_executor(
                None, lambda: model.generate_content(prompt)
            )
            yield result.text

    async def _openrouter(self, prompt: str, stream: bool) -> AsyncIterator[str]:
        if not self.api_key:
            raise ValueError("OpenRouter API key is not set. Add it in Settings.")
        from openai import AsyncOpenAI
        client = AsyncOpenAI(
            api_key=self.api_key,
            base_url="https://openrouter.ai/api/v1",
            default_headers={"HTTP-Referer": "http://localhost:3000", "X-Title": "superaXiom"},
        )
        params = dict(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=3000,
            frequency_penalty=0.1,
        )
        if stream:
            raw_stream = await client.chat.completions.create(**params, stream=True)
            async for chunk in raw_stream:
                choices = getattr(chunk, "choices", None)
                if not choices:
                    continue
                choice = choices[0]
                finish_reason = getattr(choice, "finish_reason", None)
                if finish_reason:
                    break
                delta = getattr(choice, "delta", None)
                if delta is None:
                    continue
                content = getattr(delta, "content", None)
                if content:
                    yield content
        else:
            resp = await client.chat.completions.create(**params)
            yield resp.choices[0].message.content

    async def _yield_openai_stream_tokens(self, stream_obj) -> AsyncIterator[str]:
        text_stream = getattr(stream_obj, "text_stream", None)
        if text_stream is not None:
            try:
                async for text in text_stream:
                    if text:
                        yield text
                return
            except Exception as e:
                logger.warning(f"text_stream parse failed, falling back to chunk parser: {e}")

        async for chunk in stream_obj:
            choices = getattr(chunk, "choices", None)
            if not choices:
                continue
            choice = choices[0]
            finish_reason = getattr(choice, "finish_reason", None)
            if finish_reason:
                break
            delta = getattr(choice, "delta", None)
            if delta is None:
                continue
            content = getattr(delta, "content", None)
            if content:
                yield content

    def status(self) -> dict:
        cfg = get_config()
        return {
            "provider": self.provider,
            "model": self.model,
            "has_api_key": cfg.has_api_key(self.provider),
            "api_key_status": {
                "ollama": False,
                "openai": cfg.has_api_key("openai"),
                "anthropic": cfg.has_api_key("anthropic"),
                "gemini": cfg.has_api_key("gemini"),
                "openrouter": cfg.has_api_key("openrouter"),
            }
        }

    def available_models(self) -> dict:
        return {
            "ollama": ["llama3.2", "llama3.1", "mistral", "mixtral", "phi3", "gemma2", "deepseek-r1"],
            "openai": ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
            "anthropic": ["claude-sonnet-4-5", "claude-haiku-4-5"],
            "gemini": ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
            "openrouter": [
                "deepseek/deepseek-chat-v3-0324",
                "deepseek/deepseek-r1",
                "anthropic/claude-sonnet-4-5",
                "openai/gpt-4o",
                "openai/gpt-4o-mini",
                "google/gemini-2.0-flash-001",
                "meta-llama/llama-3.3-70b-instruct",
                "mistralai/mistral-large-2411",
            ]
        }

    async def check_ollama(self) -> bool:
        import httpx
        try:
            client = httpx.AsyncClient(timeout=httpx.Timeout(3.0, connect=2.0))
            resp = await client.get(f"{self.ollama_url}/api/tags")
            await client.aclose()
            return resp.status_code == 200
        except Exception:
            return False

_router: ModelRouter | None = None

def get_router() -> ModelRouter:
    global _router
    if _router is None:
        _router = ModelRouter()
    return _router
