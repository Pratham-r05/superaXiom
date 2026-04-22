import modal
import os

data_volume = modal.Volume.from_name("axiom-data", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install_from_requirements("requirements.txt")
    .add_local_dir("axiom", remote_path="/project/axiom")
    .add_local_dir("frontend", remote_path="/project/frontend")
    .add_local_file("main.py", remote_path="/project/main.py")
    .add_local_file("config.py", remote_path="/project/config.py")
    .add_local_file("requirements.txt", remote_path="/project/requirements.txt")
)

app = modal.App("axiom", image=image)

@app.function(
    image=image,
    volumes={"/data": data_volume},
    secrets=[modal.Secret.from_name("axiom-secrets")],
    timeout=120,
    min_containers=1,
)
@modal.asgi_app()
def fastapi_app():
    import sys
    sys.path.insert(0, "/project")
    os.chdir("/project")
    os.environ["CHROMA_PERSIST_DIR"] = "/data/chroma_db"
    os.environ["UPLOAD_DIR"] = "/data/uploads"
    os.environ["TITLE_CACHE_DB"] = "/data/title_cache.db"
    from main import app as axiom_app
    return axiom_app

@app.function(schedule=modal.Period(minutes=2))
def keep_warm():
    import httpx
    target = os.getenv("AXIOM_HEALTHCHECK_URL", "https://endraode-7--axiom-fastapi-app.modal.run/api/health")
    httpx.get(target, timeout=10)