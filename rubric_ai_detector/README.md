# rubric_ai_detector

Lightweight starter scaffold for a university auto-grading capstone project.

This repository demonstrates three CPU-friendly pipelines for **Python submissions**:

1. **`ai_detect`**: binary classifier that estimates whether style is likely AI-generated.
2. **`rubric`**: multi-output regressor that predicts rubric sub-scores (readability/design/docs).
3. **`plagiarism`**: rule/similarity-based pairwise comparison (no neural model) for suspicious similarity flags.

> ⚠️ This project is intentionally a starter baseline. Results should be treated as **advisory flags for instructor review**, not automatic proof or punishment.

---

## 1) Prerequisites

- Python 3.10+
- CPU-only environment
- No GPU/CUDA required

## 2) Create a virtual environment

### macOS / Linux

```bash
cd rubric_ai_detector
python3 -m venv .venv
source .venv/bin/activate
```

### Windows (PowerShell)

```powershell
cd rubric_ai_detector
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
```

## 3) Install dependencies

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

## 4) Add training data

Put `.py` submissions in:

- Human-authored: `ai/data/raw/human/`
- AI-authored: `ai/data/raw/ai/`

Each file should be named `<sample_id>.py` and have a corresponding row in `ai/data/labels.csv`.

## 5) Format `labels.csv`

Required columns:

- `sample_id`
- `source` (`human` or `ai`)
- `label_ai` (`0` for human, `1` for AI)
- `readability_points`
- `design_points`
- `docs_points`

Example (`ai/data/labels.example.csv`):

```csv
sample_id,source,label_ai,readability_points,design_points,docs_points
human_example_001,human,0,4.5,4.0,3.5
ai_example_001,ai,1,2.5,2.0,1.5
```

## 6) Prepare the dataset

This extracts static code features, creates train/val/test splits, standardizes features, and writes `.npy` artifacts.

```bash
python -m ai.prepare_dataset --language python
```

Outputs include:

- `ai/data/features/X_train.npy`, `X_val.npy`, `X_test.npy`
- `ai/data/features/y_ai_*.npy`
- `ai/data/features/Y_rubric_*.npy` (if rubric columns exist)
- `ai/data/features/scaler.joblib`
- `ai/data/features/feature_names.json`
- metadata CSVs in `ai/data/splits/`

## 7) Train `ai_detect`

```bash
python -m ai.train --task ai_detect --epochs 100 --batch_size 16 --lr 1e-3 --weight_decay 1e-4 --patience 10
```

Model checkpoint saved to:

- `ai/output/best_ai_detect.pth`

## 8) Train `rubric`

```bash
python -m ai.train --task rubric --epochs 100 --batch_size 16 --lr 1e-3 --weight_decay 1e-4 --patience 10
```

Model checkpoint saved to:

- `ai/output/best_rubric.pth`

## 9) Evaluate both tasks

### AI detector evaluation

```bash
python -m ai.evaluate --task ai_detect --threshold 0.85
```

Reports ROC-AUC, confusion matrix, precision/recall/F1 and saves:

- `ai/output/evaluation_ai_detect.json`

### Rubric evaluation

```bash
python -m ai.evaluate --task rubric
```

Reports overall MAE + per-dimension MAE and saves:

- `ai/output/evaluation_rubric.json`

## 10) Inference on one file

### AI detector inference

```bash
python -m ai.infer --task ai_detect --file ai/data/raw/human/human_example_001.py --threshold 0.85
```

Output JSON fields:

- `ai_generated_probability`
- `flagged`
- `threshold`

### Rubric inference

```bash
python -m ai.infer --task rubric --file ai/data/raw/human/human_example_001.py
```

Output JSON field:

- `predicted_rubric_scores`

## 11) Plagiarism comparison across many submissions

Compare all `.py` files in one folder:

```bash
python -m ai.plagiarism --folder submissions_folder --mode global --top_k 20 --threshold 0.85 --output ai/output/plagiarism_report.json --csv_output ai/output/plagiarism_report.csv
```



### Assignment-only mode (ignores shared starter scaffolds)

If your directory is organized by assignment:

```
submissions_root/
  assignment_1/
    student_a.py
    student_b.py
  assignment_2/
    student_c.py
    student_d.py
```

Run:

```bash
python -m ai.plagiarism --folder submissions_root --mode assignment --top_k 20 --threshold 0.85
```

In `assignment` mode, comparisons are performed **only within each assignment folder**. The script also strips an exact common token prefix across all submissions in that assignment as a lightweight way to ignore shared instructor starter code blocks.

Signals combined into final score:

- normalized text similarity
- token-sequence similarity (difflib)
- token Jaccard similarity
- AST node-type sequence similarity

### Safe interpretation guidance

Plagiarism output is **only a triage signal**:

- High similarity can be legitimate (starter code, common solutions, small assignments).
- Always perform manual review before any academic integrity action.
- Use this report alongside version history, assignment constraints, and instructor judgment.

---

## Design assumptions

- Current implementation supports **Python only**, but dataset prep has a language arg for future extension.
- Small MLP + engineered features keeps runtime and infrastructure lightweight for AWS CPU deployment.
- Rubric prediction assists human grading; deterministic correctness tests should remain separate.