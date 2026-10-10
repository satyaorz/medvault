import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Tests must be deterministic and offline: never call a real LLM.
os.environ["LLM_PROVIDER"] = "rules"
os.environ.pop("ANTHROPIC_API_KEY", None)


@pytest.fixture(autouse=True)
def _rules_provider(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "rules")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)


LAB_REPORT = """CITYCARE DIAGNOSTICS
14, MG Road, Pune - 411001  |  Ph: 020-2555 0101
Patient Name : Mr. Arjun Mehta  Age/Sex : 52 Y / M
Ref. By : Dr. Meera Kapoor  Lab No : 943992
Collected On : 20/05/2026  Reported On : 21/05/2026
DIABETES PROFILE
Test Name  Result  Unit  Biological Ref. Range
Glycated Haemoglobin (HbA1c)  6.2 H  %  4.0 - 5.6
FBS  6.30  mmol/L  3.89 - 5.55
COMPLETE BLOOD COUNT (CBC)
HGB  136  g/L  130 - 170
Platelet Count  2.5  lakhs/cumm  1.5 - 4.1
Total WBC Count  7500  /cumm  4000 - 11000
25-OH Vitamin D  14.0 L  ng/mL  30 - 100
*** End of Report ***
Dr. Priya Nair, MD (Pathology)
"""

PRESCRIPTION = """Heart & Diabetes Care Centre
Dr. Arjun Sharma  MBBS, DM (Cardiology)  |  Reg. No. MMC/12345
Name: Arjun Mehta  Age/Sex: 52/M  Date: 15/08/2026
BP: 142/90 mmHg   Pulse: 78/min
Diagnosis: Essential Hypertension, Type 2 Diabetes Mellitus
Allergies: Penicillin (rash)
Rx
1. TAB. Amlong 10   1-0-0  x 30 days  (after food)
2. TAB. Rosuvas 10   0-0-1  x 30 days
Tab Glycomet 500 - 1-0-1 - AF - 30 days
4. Syp. Crocin 5ml  SOS
5. TAB. Telma 40
      1-0-0 BF x 30 days
Review on 15/11/2026 with HbA1c
Dr. Arjun Sharma
"""

DISCHARGE = """CITY GENERAL HOSPITAL
DISCHARGE SUMMARY
Patient Name: Arjun Mehta  Age/Sex: 52 Yrs / M
Date of Admission: 02/03/2026  Date of Discharge: 05/03/2026
Consultant: Dr. Rajesh Khanna
Final Diagnosis: Acute Gastroenteritis, Essential Hypertension
Allergies: Penicillin (rash)
Course in Hospital:
Managed with IV fluids and antibiotics. Improved.
Investigations:
Hemoglobin: 13.9 g/dL
Serum Creatinine: 1.1 mg/dL
Discharge Medications:
1. TAB. Pan 40   1-0-0  x 7 days  (before food)
2. TAB. Ondem 4   SOS  x 3 days
Follow up: OPD after 1 week
Condition at discharge: Stable
"""
