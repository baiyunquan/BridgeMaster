#!/usr/bin/env python3
"""
generate_exam_pdf.py — Generate a PDF exam sheet from board completion data.

Reads JSON input from stdin (or a file argument), writes a Markdown file and
a matching PDF suitable for printing.

Input format (JSON):
{
  "examName": "桥牌期末A卷",
  "boards": [
    {"boardNo": 1, "vulnerability": "N", "completed": true},
    ...
  ]
}

Output:
  exams/exam_sheet_<examName>.md
  exams/exam_sheet_<examName>.pdf
"""

import json
import os
import re
import sys
from pathlib import Path


def sanitize_filename(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', "_", name)


def build_markdown(exam_name: str, boards: list[dict]) -> str:
    lines = []
    lines.append(f"# 双人赛桥牌期末考试记分表\n")
    lines.append(f"**考试名称：** {exam_name}\n")
    lines.append("")
    lines.append("| 轮次 | 局 况 | 定约 | 结果 | 南北得分 | 东西得分 | 备注 |")
    lines.append("|------|-------|------|------|----------|----------|------|")

    total_ns = 0
    total_ew = 0
    for b in boards:
        result = b.get("resultText", "")
        contract_str = b.get("contractStr", "")
        ns = int(b.get("nsPoints", 0))
        ew = int(b.get("ewPoints", 0))
        total_ns += ns
        total_ew += ew
        lines.append(f"| {b['boardNo']} | {b['vulnerability']} | {contract_str} | {result} | {ns} | {ew} | |")

    lines.append(f"| 合计 | | | | {total_ns} | {total_ew} | |")
    lines.append("")
    lines.append(f"*生成时间：{__import__('time').strftime('%Y-%m-%d %H:%M')}*")
    return "\n".join(lines) + "\n"


def generate_pdf(md_content: str, output_path: Path) -> None:
    from fpdf import FPDF

    pdf = FPDF()
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=20)

    # Find a Chinese-capable font on Windows
    font_name = "Helvetica"
    cjk_available = False
    for candidate in [
        "C:/Windows/Fonts/msyh.ttc",    # Microsoft YaHei
        "C:/Windows/Fonts/simsun.ttc",   # SimSun
        "C:/Windows/Fonts/simhei.ttf",   # SimHei
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
    ]:
        if os.path.exists(candidate):
            pdf.add_font("CJK", "", candidate, uni=True)
            font_name = "CJK"
            cjk_available = True
            break

    # Title (use bold only with built-in fonts)
    if cjk_available:
        pdf.set_font(font_name, "", 16)
    else:
        pdf.set_font(font_name, "B", 18)
    pdf.cell(0, 14, "双人赛桥牌期末考试记分表", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.ln(4)

    # Exam name
    pdf.set_font(font_name, "", 11)
    exam_name_line = md_content.split("\n")[1] if len(md_content.split("\n")) > 1 else ""
    exam_name_clean = exam_name_line.replace("**考试名称：**", "").replace("*", "").replace("**", "").strip() if "考试名称" in exam_name_line else ""
    if exam_name_clean:
        pdf.cell(0, 8, f"考试名称：{exam_name_clean}", new_x="LMARGIN", new_y="NEXT", align="L")
        pdf.ln(3)

    # Parse table from markdown
    rows = []
    for line in md_content.split("\n"):
        if line.startswith("|") and "---" not in line and "轮次" not in line:
            cells = [c.strip() for c in line.strip("|").split("|")]
            if cells and cells[0] not in ("合计", ""):
                rows.append(cells) if cells[0] else None

    # Column widths (total = 190 for A4 with 10mm margins)
    col_widths = [18, 18, 22, 22, 32, 32, 46]  # sum = 190

    # Table header
    headers = ["轮次", "局况", "定约", "结果", "南北得分", "东西得分", "备注"]

    pdf.set_font(font_name, "", 10)
    for i, h in enumerate(headers):
        pdf.cell(col_widths[i], 8, h, border=1, align="C")
    pdf.ln()

    # Table rows
    for cells in rows:
        for i, cell in enumerate(cells):
            pdf.cell(col_widths[i], 7, cell[:12] if len(cell) > 12 else cell, border=1, align="C")
        pdf.ln()

    # Total row
    pdf.set_font(font_name, "", 10)
    pdf.cell(sum(col_widths[:2]), 7, "合计", border=1, align="C")
    for _ in range(len(col_widths) - 2):
        pdf.cell(col_widths[2], 7, "", border=1, align="C")
    pdf.ln()

    # Generation time
    pdf.ln(5)
    pdf.set_font(font_name, "", 8)
    gen_time = md_content.strip().split("\n")[-1].replace("*", "") if md_content.strip().split("\n")[-1].startswith("*") else ""
    if gen_time:
        pdf.cell(0, 6, gen_time, new_x="LMARGIN", new_y="NEXT", align="R")

    pdf.output(str(output_path))


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--help":
        print(__doc__)
        sys.exit(0)

    # Read input: file argument or stdin
    if len(sys.argv) > 1:
        with open(sys.argv[1], "r", encoding="utf-8") as f:
            data = json.load(f)
    else:
        data = json.load(sys.stdin)

    exam_name = data.get("examName", "未命名考试")
    boards = data.get("boards", [])

    export_dir = Path(__file__).resolve().parent / "exams"
    export_dir.mkdir(parents=True, exist_ok=True)

    safe_name = sanitize_filename(exam_name)

    # Write markdown
    md_content = build_markdown(exam_name, boards)
    md_path = export_dir / f"exam_sheet_{safe_name}.md"
    md_path.write_text(md_content, encoding="utf-8")
    print(f"  Markdown -> {md_path}")

    # Generate PDF
    pdf_path = export_dir / f"exam_sheet_{safe_name}.pdf"
    generate_pdf(md_content, pdf_path)
    print(f"  PDF      -> {pdf_path}")

    # Output paths as JSON for callers
    print(json.dumps({"markdown": str(md_path), "pdf": str(pdf_path)}))


if __name__ == "__main__":
    main()
