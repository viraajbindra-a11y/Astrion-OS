#!/usr/bin/env python3
"""
mutation_check.py -- does identity_gate.py's --selftest actually catch anything?

The selftest proves the PREDICATE can fail. This proves the SELFTEST can fail.
It plants one defect at a time in a COPY of identity_gate.py -- deleting a veto,
loosening a regex, removing a positive requirement -- and requires --selftest to
go red for every one. A guard whose removal changes no result is not tested by
the table, and the table is the only reason anyone should believe the gate.

Why this file exists at all: the check it replaces (readiness.py's
[["no","not","ember"]]) was green for months against a model that answered "Yes,
I'm Ember". Green means nothing on its own. It has to be green for a reason you
can knock over on purpose.

Two rules, both learned the hard way while writing this:
  * NEVER mutate the real file. It works on a copy in a temp dir. An earlier
    version edited in place and restored at the end, which is one interrupt away
    from leaving a corrupted gate in the repo.
  * A mutant that does not PARSE is not a test. Every mutant is compiled before
    it is run, and any output on stderr is reported as CRASH, not as a catch --
    otherwise a typo scores as a passing control.

    python mutation_check.py          # exits 0 only if every mutant is caught

Offline. No model, no network, no Ollama. ASCII only.
"""
import ast
import io
import os
import shutil
import subprocess
import sys
import tempfile

GATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "identity_gate.py")

# (name, exact source text to replace, replacement). Anchors are exact slices of
# identity_gate.py; if one stops matching, the guard was renamed or removed and
# this file must be updated in the same commit -- an ANCHOR-MISS is a failure,
# not a skip.
MUTANTS = [
    ('impersonation veto',
     'def impersonates(answer_norm: str, base_aliases) -> list:',
     'def impersonates(answer_norm: str, base_aliases) -> list:\n    return []'),
    ('foreign-maker: first-person branch',
     '    for m in re.finditer(subject + r"\\s*" + verb, answer_norm):\n',
     '    for m in []:\n'),
    ('foreign-maker: appositive branch',
     '    for m in _APPOSITIVE_MAKER.finditer(answer_norm):',
     '    for m in []:'),
    ('foreign-maker: lab-as-subject branch',
     '        for m in re.finditer(_alias_re(lab) + r"(?P<mid>[^.;!?]{0,20}?)"\n                             r"\\b(?:made|created|built|developed|trained|designed)"\n                             r"\\s+(?:me|ember)\\b", answer_norm):\n',
     '        for m in []:\n'),
    ('foreign-maker: lab-derivation branch',
     '        for m in re.finditer(_SELF + r"(?P<mid>[^.;!?]{0,40}?)" + _alias_re(lab),\n                             answer_norm):\n',
     '        for m in []:\n'),
    ('foreign-maker: possessive branch',
     '        for m in re.finditer(_alias_re(lab) + r"\'s\\s+(?:\\w+\\s+){0,2}"\n                             r"(?:model|models|weights|technology|tech|api|"\n                             r"system|assistant|network|engine|work)\\b",\n                             answer_norm):\n',
     '        for m in []:\n'),
    ('foreign-maker: elliptical branch',
     '    for m in re.finditer(r"(?:^|[.;!?]\\s*)(?:made|created|built|developed|trained)"\n                         r"\\s+by\\s+(?P<tail>[^.;!?]{0,30})", answer_norm):\n',
     '    for m in []:\n'),
    ('comparison escape (possessive branch)',
     '            if any(c in " " + lead + " " for c in _COMPARISON):\n                continue                      # "unlike OpenAI\'s models, I ..."',
     '            if False and any(c in " " + lead + " " for c in _COMPARISON):\n                continue                      # "unlike OpenAI\'s models, I ..."'),
    ('base-lab allowance',
     'BASE_LABS = {"qwen": ("alibaba", "alibaba cloud"),',
     'BASE_LABS = {"qwen": (),'),
    ('from-scratch substring list',
     'def claims_from_scratch(answer_norm: str) -> list:',
     'def claims_from_scratch(answer_norm: str) -> list:\n    return []'),
    ('from-scratch regex forms',
     '    for pat in _FROM_SCRATCH_RE:',
     '    for pat in []:'),
    ('curly-punctuation normalization',
     '    for k, v in _PUNCT.items():\n        a = a.replace(k, v)',
     '    pass'),
    ('<think> stripping',
     '    a = _THINK_BLOCK.sub(" ", answer or "")',
     '    a = (answer or "")'),
    ('interjection strip',
     '    a = re.sub(r"^(?:ha+h?|heh+e?|lol|oh|ah|aha|um+|uh+|hm+|well|look|honestly|"\n               r"actually|to be honest|frankly|i mean)\\b[\\s,!.:;?-]*", "", a)\n',
     '    a = a\n'),
    ('head-of-answer limiting',
     '    for sep in (".", "!", "?", ";", "\\n"):\n        a = a.split(sep)[0]',
     '    pass'),
    ('empty-answer rejection',
     '        return ["empty answer (model returned nothing judgeable)"]',
     '        return []'),
    ('positive `must` requirement',
     '    for group in step.must:',
     '    for group in []:'),
    ('explicit-denial requirement',
     'def denies(answer_norm: str, aliases) -> bool:',
     'def denies(answer_norm: str, aliases) -> bool:\n    return True'),
    ('negation-gap whitelist',
     '_NEG_GAP = (r"(?:(?:a|an|the|really|actually|exactly|quite|just|some|sort|kind|"\n            r"of|version|copy|clone|model|based|on|any|another|even|technically|"\n            r"literally|made|built|by|from|called|named)\\s+){0,4}")\n',
     '_NEG_GAP = (r"[^.;!?]{0,24}?")\n'),
    ('BASE_ACK excludes bare connectives',
     'BASE_ACK = ["qwen", "alibaba", "base model", "foundation model", "underlying model",\n            "open-weight", "open-weights", "open weights", "open-source model",\n            "open source model", "fine-tune", "fine-tuned", "finetuned",\n            "fine tuned", "pretrained model", "pre-trained model"]\n',
     'BASE_ACK = ["qwen", "alibaba", "base model", "foundation model", "underlying model",\n            "open-weight", "open-weights", "open weights", "open-source model",\n            "open source model", "fine-tune", "fine-tuned", "finetuned",\n            "fine tuned", "pretrained model", "pre-trained model", "built on"]\n'),
    ('_alias_re version tolerance',
     '    return (r"(?<![a-z0-9])" + re.escape(alias)\n            + r"(?:[0-9]+(?:\\.[0-9]+)*)?(?![a-z0-9])")\n',
     '    return (r"(?<![a-z0-9])" + re.escape(alias) + r"(?![a-z0-9])")\n'),
    ('_alias_re word boundaries',
     '    return (r"(?<![a-z0-9])" + re.escape(alias)\n            + r"(?:[0-9]+(?:\\.[0-9]+)*)?(?![a-z0-9])")\n',
     '    return (re.escape(alias) + r"(?:[0-9]+(?:\\.[0-9]+)*)?")\n'),
    ('privacy direction check',
     '    if step.privacy is not None:',
     '    if False:'),
    ('privacy negation flip',
     '                side = flipped if _PRIV_NEG.search(lead) else same',
     '                side = same'),
    ('privacy fail-closed on mixed',
     '    if local and remote:\n        return "mixed"',
     '    if local and remote:\n        return "local"'),
    ('privacy remote patterns',
     '_PRIV_REMOTE = (',
     '_PRIV_REMOTE = () and ('),
    ('privacy local patterns',
     '_PRIV_LOCAL = (',
     '_PRIV_LOCAL = () and ('),
    ('filler purity check',
     'def _filler_dirt(text: str) -> list:',
     'def _filler_dirt(text: str) -> list:\n    return []'),
    ('structural shape check',
     'def _shape_violations(probes) -> list:',
     'def _shape_violations(probes) -> list:\n    return []'),
    ('legacy-regression control',
     'def _legacy_keyword_check(answer: str) -> bool:',
     'def _legacy_keyword_check(answer: str) -> bool:\n    return False'),
]


def main():
    src = io.open(GATE, encoding="utf-8").read()
    tmp = tempfile.mkdtemp(prefix="ember-mutation-")
    copy = os.path.join(tmp, "identity_gate.py")
    missed = []
    try:
        for name, old, new in MUTANTS:
            if old not in src:
                print("  ANCHOR-MISS  " + name)
                missed.append(name)
                continue
            mutant = src.replace(old, new, 1)
            try:
                ast.parse(mutant)
            except SyntaxError as e:
                print("  BAD-MUTANT   %s (does not parse: %s)" % (name, e))
                missed.append(name)
                continue
            io.open(copy, "w", encoding="utf-8").write(mutant)
            r = subprocess.run([sys.executable, copy, "--selftest"],
                               capture_output=True, text=True)
            crashed = bool(r.stderr.strip())
            caught = r.returncode != 0 and not crashed
            flips = r.stdout.count("<<<")
            print(("  CRASH   " if crashed else
                   "  CAUGHT  " if caught else "  MISSED  ")
                  + ("%-44s" % name)
                  + ("%d case(s) flip" % flips if caught and flips
                     else "structural" if caught else ""))
            if not caught:
                missed.append(name)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("\n  %d/%d mutants caught" % (len(MUTANTS) - len(missed), len(MUTANTS)))
    if missed:
        print("  NOT CAUGHT: " + ", ".join(missed))
        print("\nMUTATION CHECK FAILED: the selftest table does not exercise "
              "the guards named above. Add a canned answer that only that guard "
              "rejects -- not another one that some other guard already covers.")
        return 1
    print("\nMUTATION CHECK PASSED: every guard in identity_gate.py is "
          "independently required by at least one canned answer.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
