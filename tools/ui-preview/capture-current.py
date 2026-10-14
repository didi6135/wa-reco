"""Capture actual-source synthetic previews; no phone, provider or recording access."""
import hashlib
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "artifacts" / "ui-preview"


def main():
    source = json.loads((OUTPUT / "current-source.json").read_text(encoding="utf-8"))
    for name, expected in source["sourceHashes"].items():
        actual = hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
        if actual != expected:
            raise SystemExit(f"Preview source changed: {name}; rerun render-current.cjs")
    manifest = {**source, "captures": [], "pageErrors": [], "synthetic": True,
                "deviceAcceptance": False}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 1320, "height": 960}, device_scale_factor=1)
        page.on("pageerror", lambda error: manifest["pageErrors"].append(str(error)))
        page.goto((OUTPUT / "current.html").as_uri())
        for language in source["languages"]:
            for width in (320, 390, 430):
                for scale in (1, 1.3):
                    page.evaluate("""({language,width,scale}) => {
                        document.querySelectorAll('.sample').forEach(el => {
                            el.style.display=el.dataset.language===language?'block':'none';
                            el.style.width=width+'px';
                            el.querySelectorAll('[data-kind="Text"]').forEach(text => {
                                const initial=text.dataset.font || getComputedStyle(text).fontSize;
                                const line=text.dataset.line || getComputedStyle(text).lineHeight;
                                text.dataset.font=initial; text.dataset.line=line;
                                text.style.fontSize=(parseFloat(initial)*scale)+'px';
                                if (line!=='normal') text.style.lineHeight=(parseFloat(line)*scale)+'px';
                            });
                        });
                    }""", {"language": language, "width": width, "scale": scale})
                    for scenario in source["scenarios"]:
                        sample = page.locator(f'.sample[data-language="{language}"][data-case="{scenario}"]')
                        overflow = sample.locator('.phone').evaluate("""el => {
                            const rect=el.getBoundingClientRect();
                            return [...el.querySelectorAll('[data-kind]')].some(node => {
                                const r=node.getBoundingClientRect();
                                return r.width>0 && (r.left<rect.left-1 || r.right>rect.right+1);
                            });
                        }""")
                        name = f"current-{language}-{scenario}-{width}-{'large' if scale>1 else 'normal'}.png"
                        sample.screenshot(path=str(OUTPUT / name))
                        manifest["captures"].append({"file": name, "language": language,
                            "scenario": scenario, "width": width, "textScale": scale,
                            "horizontalOverflow": overflow,
                            "sha256": hashlib.sha256((OUTPUT / name).read_bytes()).hexdigest()})
            # Compact review image of the two Settings states and first connection.
            page.evaluate("""language => document.querySelectorAll('.sample').forEach(el => {
                el.style.display=el.dataset.language===language &&
                  ['settings-ready','settings-missing','setup-fresh'].includes(el.dataset.case)?'block':'none';
                el.style.width='390px';
                el.querySelectorAll('[data-kind="Text"]').forEach(text => {
                    text.style.fontSize=text.dataset.font; text.style.lineHeight=text.dataset.line;
                });
            })""", language)
            page.screenshot(path=str(OUTPUT / f"current-review-{language}.png"), full_page=True)
        browser.close()
    (OUTPUT / "current-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    failures = sum(capture["horizontalOverflow"] for capture in manifest["captures"])
    print(json.dumps({"captures": len(manifest["captures"]), "sourceFiles": len(source["sourceHashes"]),
                      "pageErrors": manifest["pageErrors"], "horizontalOverflowCases": failures}))
    if failures or manifest["pageErrors"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
