from langchain_core.prompts import PromptTemplate

# ── Beginner Friendly ──────────────────────────────────────────
beginner = PromptTemplate(
    template="""
You are explaining a research paper to someone with no technical background.

Paper: {paper_input}
Length: {length_input}
Focus: {focus_input}

Follow this exact structure:
🎯 **What problem does this solve?**
Explain in plain English. Use a real-world analogy.

💡 **The Big Idea**
What did the researchers do? Explain like teaching a curious 16-year-old.
No jargon. If you must use a technical term, immediately explain it in brackets.

🌍 **Why does this matter?**
What changes in the real world because of this paper?

⚡ **One Line Summary**
Summarize the entire paper in exactly one sentence a non-technical person would understand.

Strictly follow the length: {length_input}
If focus is provided, make sure to address: {focus_input}
""",
    input_variables=["paper_input", "length_input", "focus_input"],
    validate_template=True
)
beginner.save("template_beginner.json")


# ── Technical ──────────────────────────────────────────────────
technical = PromptTemplate(
    template="""
You are a senior AI researcher reviewing a paper for a technical audience.

Paper: {paper_input}
Length: {length_input}
Focus: {focus_input}

Follow this exact structure:
🔬 **Problem Statement**
What gap in literature does this address? What are the limitations of prior work?

⚙️ **Methodology**
Explain the architecture, algorithm, or approach in precise technical detail.
Include model design choices, training setup, and key hyperparameters if mentioned.

📊 **Results & Benchmarks**
What datasets were used? What metrics? How does it compare to SOTA?
Include specific numbers.

🧠 **Key Contributions**
List the novel contributions clearly. What is new vs what builds on prior work?

⚠️ **Limitations & Future Work**
What does the paper acknowledge as limitations? What are open problems?

Strictly follow the length: {length_input}
If focus is provided, prioritize: {focus_input}
""",
    input_variables=["paper_input", "length_input", "focus_input"],
    validate_template=True
)
technical.save("template_technical.json")


# ── Code Oriented ──────────────────────────────────────────────
code = PromptTemplate(
    template="""
You are a software engineer explaining a research paper from an implementation perspective.

Paper: {paper_input}
Length: {length_input}
Focus: {focus_input}

Follow this exact structure:
🛠️ **What are we building?**
Describe the system or model in engineering terms.

🏗️ **Architecture Overview**
Describe the components, modules, and data flow.
If applicable, write pseudocode for the core algorithm.

📦 **Libraries & Tools**
What frameworks, datasets, or tools would you need to implement this?
(e.g. PyTorch, HuggingFace, JAX, CUDA)

💻 **Implementation Sketch**
Write a short pseudocode or Python-style code sketch of the core idea.
Keep it illustrative, not production-ready.

🚀 **Practical Takeaway**
How would a developer use or build on this paper today?
Any existing open source implementations?

Strictly follow the length: {length_input}
If focus is provided, prioritize: {focus_input}
""",
    input_variables=["paper_input", "length_input", "focus_input"],
    validate_template=True
)
code.save("template_code.json")


# ── Mathematical ───────────────────────────────────────────────
mathematical = PromptTemplate(
    template="""
You are a mathematician and ML researcher explaining a paper with full mathematical rigor.

Paper: {paper_input}
Length: {length_input}
Focus: {focus_input}

Follow this exact structure:
📐 **Problem Formulation**
State the problem mathematically. Define all variables, spaces, and objectives formally.

∑ **Core Mathematics**
Derive or explain the key equations in the paper.
CRITICAL formatting rules:
- Standalone equations: $$ equation $$
- Inline math: $ expression $
- Never use \\[ or \\( brackets
Explain each term in every equation.

🔁 **Algorithm / Proof Sketch**
If there is an algorithm, write it step by step with mathematical notation.
If there is a theoretical result, sketch the proof or key insight.

📈 **Convergence / Complexity**
What are the theoretical guarantees? Time complexity? Sample complexity?

💎 **Mathematical Novelty**
What is mathematically new here vs prior work?

Strictly follow the length: {length_input}
If focus is provided, prioritize: {focus_input}
""",
    input_variables=["paper_input", "length_input", "focus_input"],
    validate_template=True
)
mathematical.save("template_mathematical.json")

print("All 4 templates saved successfully.")