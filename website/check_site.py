"""Bounded local browser QA: static website, synthetic fixtures, no provider actions."""
import argparse
import copy
import hashlib
import json
import re
import traceback
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from playwright.sync_api import sync_playwright


RELEASE_ROOT = 'https://github.com/didi6135/wa-reco/releases/download/v1.5.12/'
EXPECTED = {'version': '1.5.12', 'url': 'https://github.com/didi6135/wa-reco/releases/download/v1.5.12/wa-reco.apk', 'filename': 'wa-reco.apk', 'sizeBytes': 32933589, 'sha256': 'ec8cd1847762c879a46b7ae4fbaea1da9c154dff91adc2c4fa35cbf8c7c63f24', 'companion': {'url': 'https://github.com/didi6135/wa-reco/releases/download/v1.5.12/source-and-notices.zip', 'filename': 'source-and-notices.zip', 'sizeBytes': 23506984, 'sha256': 'ff117f5b56ddd1f107b706323841237a7a44bdb6f4c89b5424c925d3f55c0186'}, 'applicationSource': {'url': 'https://github.com/didi6135/wa-reco/releases/download/v1.5.12/application-source.zip', 'filename': 'application-source.zip', 'sizeBytes': 1336435, 'sha256': '410f739a64e53dda8d04c045e00882fd5e8546ba85fb0fde26f53bcb851c94bc'}, 'sourceUrl': 'https://github.com/didi6135/wa-reco/tree/e45a37b9b2408da3765bee13e799c295239d0ee4'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8789/")
    parser.add_argument("--dist", default=str(Path(__file__).resolve().parent / "dist"))
    parser.add_argument("--browser-channel", help="Use an installed browser, such as chrome or msedge")
    parser.add_argument("--output", default=str(Path(__file__).resolve().parent.parent / "artifacts" / "website"))
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    passed, failed, page_errors, console_errors, requests = [], [], [], [], []
    phase = ["initial"]
    actual_metadata = None
    screenshots = []

    def check(condition, label, evidence=None):
        item = {"label": label}
        if evidence is not None:
            item["evidence"] = evidence
        (passed if condition else failed).append(item)

    def section(label, fn):
        phase[0] = label
        try:
            fn()
        except Exception as error:
            failed.append({"label": label + ": section completed", "error": str(error), "traceback": traceback.format_exc()})
            if label == "metadata-fixtures":
                page.unroute("**/release-metadata.json")

    def screenshot(page, name, locator=None):
        path = output / (name + ".png")
        if locator is None:
            page.screenshot(path=str(path), full_page=True)
        else:
            page.locator(locator).screenshot(path=str(path))
        screenshots.append(str(path))

    def no_overflow(page, label):
        sizes = page.evaluate("""() => ({
          viewport: innerWidth,
          document: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
          offenders: Array.from(document.body.querySelectorAll('*')).map(n => {
            const r = n.getBoundingClientRect();
            return {tag:n.tagName, id:n.id, cls:String(n.className).slice(0,90), left:r.left, right:r.right};
          }).filter(r => r.left < -1 || r.right > innerWidth + 1).slice(0,15)
        })""")
        check(max(sizes["document"], sizes["body"]) <= sizes["viewport"] + 1, label + ": no horizontal overflow", sizes)

    def language(page, code, policy=False):
        selector = f'[data-policy-language="{code}"]' if policy else f'[data-language="{code}"]'
        page.locator(selector).click()
        check(page.locator("html").get_attribute("lang") == code, f'{phase[0]}/{code}: document language')
        check(page.locator("html").get_attribute("dir") == ("rtl" if code == "he" else "ltr"), f'{phase[0]}/{code}: document direction')
        check(page.locator(selector).get_attribute("aria-pressed") == "true", f'{phase[0]}/{code}: language announced')
        inactive = f'[data-policy-language="{"en" if code == "he" else "he"}"]' if policy else f'[data-language="{"en" if code == "he" else "he"}"]'
        check(page.locator(inactive).get_attribute("aria-pressed") == "false", f'{phase[0]}/{code}: other language unselected')
        check(page.evaluate("localStorage.getItem('wa-reco-language')") == code, f'{phase[0]}/{code}: preference persisted')
        check(page.locator('meta[name="description"]').get_attribute("content").strip() != "", f'{phase[0]}/{code}: populated description')
        text = page.locator("body").inner_text()
        check("\ufffd" not in text and "undefined" not in text, f'{phase[0]}/{code}: no replacement/missing-key text')
        return {"title": page.title(), "description": page.locator('meta[name="description"]').get_attribute("content"), "main": page.locator("h1").inner_text()}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, channel=args.browser_channel)
        context = browser.new_context(viewport={"width": 390, "height": 844}, reduced_motion="reduce")
        page = context.new_page()
        page.on("pageerror", lambda error: page_errors.append({"phase": phase[0], "error": str(error)}))
        page.on("console", lambda message: console_errors.append({"phase": phase[0], "error": message.text}) if message.type == "error" else None)
        page.on("request", lambda request: requests.append({"phase": phase[0], "url": request.url, "resourceType": request.resource_type}))

        def initial():
            nonlocal actual_metadata
            with page.expect_response("**/release-metadata.json") as response_info:
                response = page.goto(args.url, wait_until="networkidle")
            check(response.status == 200, "homepage: HTTP 200")
            metadata_response = response_info.value
            check(metadata_response.status == 200, "actual release metadata: HTTP 200")
            actual_metadata = metadata_response.json()
            check(actual_metadata.get("status") == "ready", "actual release metadata: ready")
            for field, value in EXPECTED.items():
                check(actual_metadata.get(field) == value, f'actual release metadata: independent expected {field}', actual_metadata.get(field))
            check(page.locator('link[rel="canonical"]').get_attribute("href") == "https://wa-reco.codaki.com/", "homepage: chosen canonical hostname")
            check(page.locator("h1").count() == 1, "homepage: single primary heading")
            check(page.locator("main#main").count() == 1, "homepage: navigable main landmark")
            check(page.locator('a[href="privacy.html"]').count() >= 1, "homepage: local privacy route")
            check(page.locator('a[href="terms.html"]').count() >= 1, "homepage: local terms route")
            check(page.locator('[data-i18n]').evaluate_all("nodes => nodes.every(n => n.textContent.trim().length > 0)"), "homepage: localized text populated")

        section("initial", initial)

        def real_downloads():
            for code in ("he", "en"):
                language(page, code)
                page.set_viewport_size({"width": 1440, "height": 1000})
                details = page.locator(".source-details")
                if details.get_attribute("open") is None:
                    details.locator("summary").click()
                for selector in ("#hero-download", "#apk-download"):
                    loc = page.locator(selector)
                    check(loc.get_attribute("href") == EXPECTED["url"], f'actual/{code}/{selector}: exact APK URL')
                    check(loc.get_attribute("download") == EXPECTED["filename"], f'actual/{code}/{selector}: exact APK filename')
                    check(loc.get_attribute("aria-disabled") == "false" and loc.get_attribute("tabindex") == "0", f'actual/{code}/{selector}: ready accessible link')
                check(page.locator("#release-details").is_visible(), f'actual/{code}: release details visible')
                check(page.locator("#release-sources").is_visible(), f'actual/{code}: matching source links visible')
                check(page.locator("#release-version").inner_text() == EXPECTED["version"], f'actual/{code}: exact version')
                check(page.locator("#release-hash").inner_text() == EXPECTED["sha256"], f'actual/{code}: exact APK checksum')
                for field, selector, hash_selector, size_selector in (
                    (EXPECTED, "#apk-download", "#release-hash", "#release-size"),
                    (EXPECTED["companion"], "#companion-download", "#companion-hash", "#companion-size"),
                    (EXPECTED["applicationSource"], "#application-source-download", "#application-source-hash", "#application-source-size"),
                ):
                    check(page.locator(selector).get_attribute("href") == field["url"], f'actual/{code}/{selector}: exact published URL')
                    check(page.locator(selector).get_attribute("download") == field["filename"], f'actual/{code}/{selector}: exact published filename')
                    check(page.locator(hash_selector).inner_text() == field["sha256"], f'actual/{code}/{hash_selector}: exact public hash')
                    formatted = page.evaluate("([bytes,language]) => `${new Intl.NumberFormat(language === 'he' ? 'he-IL' : 'en-US', {minimumFractionDigits:1, maximumFractionDigits:1}).format(bytes/1000000)} MB`", [field["sizeBytes"], code])
                    check(page.locator(size_selector).inner_text() == formatted, f'actual/{code}/{size_selector}: bytes formatted as decimal MB', page.locator(size_selector).inner_text())
                check(page.locator("#release-source").get_attribute("href") == EXPECTED["sourceUrl"], f'actual/{code}: frozen source commit URL')

        section("actual-downloads", real_downloads)

        def localization():
            snapshots = {}
            for code in ("he", "en"):
                snapshots[code] = language(page, code)
                check(page.locator('[data-i18n]').evaluate_all("nodes => nodes.every(n => n.textContent.trim().length > 0)"), f'{code}: all main translation nodes populated')
                page.reload(wait_until="networkidle")
                check(page.locator("html").get_attribute("lang") == code, f'{code}: reload preserves language')
                check(page.locator("html").get_attribute("dir") == ("rtl" if code == "he" else "ltr"), f'{code}: reload preserves direction')
                labels = page.locator('[data-i18n-aria]').evaluate_all("nodes => nodes.map(n => n.getAttribute('aria-label'))")
                check(all(label and label.strip() for label in labels), f'{code}: declared ARIA translations populated', labels)
                if page.locator('meta[property="og:locale"]').count():
                    check(page.locator('meta[property="og:locale"]').get_attribute("content") == ("he_IL" if code == "he" else "en_US"), f'{code}: sharing locale follows language')
                for meta_selector, prop in [('meta[property="og:title"]', 'title'), ('meta[property="og:description"]', 'description')]:
                    if page.locator(meta_selector).count():
                        check(page.locator(meta_selector).get_attribute("content") == snapshots[code][prop], f'{code}: sharing {prop} follows language')
            check(snapshots["he"]["title"] != snapshots["en"]["title"], "he/en: title translated")
            check(snapshots["he"]["description"] != snapshots["en"]["description"], "he/en: description translated")
            check(snapshots["he"]["main"] != snapshots["en"]["main"], "he/en: headline translated")

        section("localization", localization)

        def responsive_and_phone():
            for code in ("he", "en"):
                language(page, code)
                for width in (320, 390, 430, 768, 1440):
                    page.set_viewport_size({"width": width, "height": 1000 if width == 1440 else 844})
                    for screen in ("record", "library", "settings"):
                        page.locator(f"#phone-tab-{screen}").click()
                        check(page.locator(f"#phone-tab-{screen}").get_attribute("aria-selected") == "true", f'{code}/{width}/{screen}: selected tab announced')
                        check(page.locator(f"#phone-tab-{screen}").get_attribute("tabindex") == "0", f'{code}/{width}/{screen}: selected tab focusable')
                        check(page.locator("#app-screen").get_attribute("aria-labelledby") == f"phone-tab-{screen}", f'{code}/{width}/{screen}: panel named by selected tab')
                        check(page.locator('[role="tab"][aria-selected="true"]').count() == 1, f'{code}/{width}/{screen}: exactly one active tab')
                        no_overflow(page, f'{code}/{width}/{screen}')
                    page.locator("#phone-tab-library").click()
                    page.evaluate("window.scrollTo(0,0)")
                    if width in (390, 1440):
                        screenshot(page, f'{code}-{width}-full')
                        screenshot(page, f'{code}-{width}-hero', '.hero-shell')
                page.set_viewport_size({"width": 390, "height": 844})
                page.locator("#phone-tab-record").focus()
                page.keyboard.press("ArrowLeft" if code == "he" else "ArrowRight")
                check(page.locator("#phone-tab-library").get_attribute("aria-selected") == "true", f'{code}: directional tab key')
                check(page.locator("#phone-tab-library").evaluate("node=>node===document.activeElement"), f'{code}: directional tab key moves focus')
                page.keyboard.press("End")
                check(page.locator("#phone-tab-settings").get_attribute("aria-selected") == "true", f'{code}: End selects last tab')
                page.keyboard.press("Home")
                check(page.locator("#phone-tab-record").get_attribute("aria-selected") == "true", f'{code}: Home selects first tab')
                record = page.locator(".mock-record")
                record.click()
                check("active" in (record.get_attribute("class") or ""), f'{code}: synthetic record starts')
                check(page.locator(".mock-timer").inner_text() == "00:07", f'{code}: explicitly synthetic timer')
                record.click()
                check("active" not in (record.get_attribute("class") or ""), f'{code}: synthetic record stops')
                details = page.locator(".activation-details")
                if details.get_attribute("open") is not None:
                    details.locator("summary").click()
                details.locator("summary").focus()
                page.keyboard.press("Enter")
                check(details.get_attribute("open") is not None, f'{code}: activation guide keyboard operable')
                details.locator("summary").click()
                for width in (320, 390, 430):
                    page.set_viewport_size({"width": width, "height": 844})
                    page.reload(wait_until="networkidle")
                    page.evaluate("""() => {
                      const nodes=Array.from(document.querySelectorAll('body *')).map(n=>[n,parseFloat(getComputedStyle(n).fontSize)]);
                      nodes.forEach(([n,size])=>n.style.fontSize=`${size*1.35}px`);
                    }""")
                    no_overflow(page, f'{code}/{width}/135-percent-fonts')
                    if width == 390:
                        screenshot(page, f'{code}-390-large-font')
                page.reload(wait_until="networkidle")

        section("responsive-phone", responsive_and_phone)

        def menu():
            for code in ("he", "en"):
                language(page, code)
                page.set_viewport_size({"width": 390, "height": 844})
                button = page.locator("#menu-toggle")
                check(button.is_visible(), f'{code}: mobile navigation control visible')
                if button.get_attribute("aria-expanded") == "true":
                    button.click()
                button.focus()
                page.keyboard.press("Enter")
                check(button.get_attribute("aria-expanded") == "true", f'{code}: keyboard opens mobile navigation')
                check(page.locator("#main-nav").is_visible(), f'{code}: opened navigation visible')
                page.keyboard.press("Escape")
                check(button.get_attribute("aria-expanded") == "false", f'{code}: Escape closes mobile navigation')
                check(button.evaluate("node=>node===document.activeElement"), f'{code}: Escape restores navigation control focus')
                button.click()
                page.locator('#main-nav a[href="#setup"]').click()
                check(button.get_attribute("aria-expanded") == "false", f'{code}: navigation closes after anchor selection')
                page.set_viewport_size({"width": 1440, "height": 1000})
                check(page.locator("#main-nav").is_visible(), f'{code}: desktop navigation visible')
                check(not button.is_visible(), f'{code}: mobile control hidden on desktop')
                page.evaluate("window.scrollTo(0,0)")

        section("mobile-menu", menu)

        def metadata_fail_closed():
            valid = {"status": "ready", **copy.deepcopy(EXPECTED)}
            cases = [
                ("pending", {"status": "pending"}),
                ("APK javascript", {**valid, "url": "javascript:alert(1)"}),
                ("APK plaintext", {**valid, "url": "http://example.test/test.apk"}),
                ("APK credentials", {**valid, "url": "https://user:password@example.test/test.apk"}),
                ("APK wrong extension", {**valid, "url": "https://example.test/test.html"}),
                ("APK invalid checksum", {**valid, "sha256": "abc"}),
                ("APK invalid size", {**valid, "sizeBytes": -1}),
                ("APK unsafe filename", {**valid, "filename": "../test.apk"}),
                ("missing companion", {**valid, "companion": None}),
                ("companion invalid checksum", {**valid, "companion": {**valid["companion"], "sha256": "abc"}}),
                ("companion plaintext", {**valid, "companion": {**valid["companion"], "url": "http://example.test/source.zip"}}),
                ("companion wrong extension", {**valid, "companion": {**valid["companion"], "url": "https://example.test/source.html"}}),
                ("source mutable branch", {**valid, "sourceUrl": "https://github.com/didi6135/wa-reco/tree/main"}),
                ("source unrelated repo", {**valid, "sourceUrl": "https://github.com/another/repo/tree/" + "c" * 40}),
                ("application source invalid checksum", {**valid, "applicationSource": {**valid["applicationSource"], "sha256": "abc"}}),
                ("application source plaintext", {**valid, "applicationSource": {**valid["applicationSource"], "url": "http://example.test/app.zip"}}),
                ("application source unsafe filename", {**valid, "applicationSource": {**valid["applicationSource"], "filename": "../app.zip"}}),
            ]

            def disabled(label):
                for selector in ("#hero-download", "#apk-download"):
                    loc = page.locator(selector)
                    check(loc.get_attribute("href") is None and loc.get_attribute("aria-disabled") == "true" and loc.get_attribute("tabindex") == "-1", f'{label}/{selector}: invalid release disabled')
                check(page.locator("#release-details").is_hidden(), f'{label}: unverified release details hidden')
                check(page.locator("#release-sources").is_hidden(), f'{label}: unverified source section hidden')
                for selector in ("#companion-download", "#application-source-download", "#release-source"):
                    check(page.locator(selector).get_attribute("href") is None, f'{label}/{selector}: no stale source URL')

            for label, fixture in cases:
                handler = lambda route, request, value=fixture: route.fulfill(status=200, content_type="application/json", body=json.dumps(value))
                page.route("**/release-metadata.json", handler)
                page.reload(wait_until="networkidle")
                disabled("fixture " + label)
                page.unroute("**/release-metadata.json", handler)
            for label, handler in (
                ("HTTP 503", lambda route: route.fulfill(status=503, content_type="application/json", body='{"error":"synthetic"}')),
                ("malformed JSON", lambda route: route.fulfill(status=200, content_type="application/json", body="{not json")),
                ("network abort", lambda route: route.abort("failed")),
            ):
                page.route("**/release-metadata.json", handler)
                page.reload(wait_until="networkidle")
                disabled("fixture " + label)
                page.unroute("**/release-metadata.json", handler)
            fixture = {**valid, "url": "releases/test.apk"}
            handler = lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps(fixture))
            page.route("**/release-metadata.json", handler)
            page.reload(wait_until="networkidle")
            check(page.locator("#apk-download").get_attribute("href") == urljoin(args.url, "releases/test.apk"), "fixture: same-origin relative APK permitted")
            page.unroute("**/release-metadata.json", handler)
            fixture = copy.deepcopy(valid)
            del fixture["applicationSource"]
            handler = lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps(fixture))
            page.route("**/release-metadata.json", handler)
            page.reload(wait_until="networkidle")
            check(page.locator("#apk-download").get_attribute("href") == EXPECTED["url"], "fixture: older valid contract without optional application source permitted")
            check(page.locator("#application-source-download").is_hidden(), "fixture: absent optional application source hidden")
            page.unroute("**/release-metadata.json", handler)
            page.reload(wait_until="networkidle")
            check(page.locator("#apk-download").get_attribute("href") == EXPECTED["url"], "actual metadata restored after all fixtures")
            language(page, "en")
            page.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__copiedHash=value;}}})")
            page.locator("#copy-hash").click()
            page.wait_for_function("window.__copiedHash !== undefined")
            check(page.evaluate("window.__copiedHash") == EXPECTED["sha256"], "checksum copy sends exact public hash to synthetic clipboard")

        section("metadata-fixtures", metadata_fail_closed)

        def policies():
            for route in ("privacy.html", "terms.html"):
                page.goto(urljoin(args.url, route), wait_until="networkidle")
                check(page.locator("html").get_attribute("lang") == "en", f'{route}: homepage language carried to policy')
                values = {}
                for code in ("he", "en"):
                    values[code] = language(page, code, policy=True)
                    check(page.locator('[data-policy-key]').evaluate_all("nodes => nodes.every(n => n.textContent.trim().length > 0)"), f'{route}/{code}: all policy text populated')
                    labels = page.locator('[data-policy-aria]').evaluate_all("nodes => nodes.map(n => n.getAttribute('aria-label'))")
                    check(all(label and label.strip() for label in labels), f'{route}/{code}: policy ARIA translated', labels)
                    page.reload(wait_until="networkidle")
                    check(page.locator("html").get_attribute("lang") == code, f'{route}/{code}: policy reload persists language')
                    for width in (320, 390, 1440):
                        page.set_viewport_size({"width": width, "height": 1000 if width == 1440 else 844})
                        no_overflow(page, f'{route}/{code}/{width}')
                        if width == 390:
                            screenshot(page, f'{route[:-5]}-{code}-390')
                    page.set_viewport_size({"width": 320, "height": 844})
                    page.evaluate("""() => {
                      const nodes=Array.from(document.querySelectorAll('body *')).map(n=>[n,parseFloat(getComputedStyle(n).fontSize)]);
                      nodes.forEach(([n,size])=>n.style.fontSize=`${size*1.35}px`);
                    }""")
                    no_overflow(page, f'{route}/{code}/320/135-percent-fonts')
                    page.reload(wait_until="networkidle")
                check(values["he"]["title"] != values["en"]["title"], f'{route}: policy title translated')
                check(values["he"]["main"] != values["en"]["main"], f'{route}: policy heading translated')
                check(page.locator('link[rel="canonical"]').get_attribute("href") == f'https://wa-reco.codaki.com/{route}', f'{route}: same-domain canonical')
                language(page, "he", policy=True)
                home = page.locator('header [data-policy-key="home"]')
                home.click()
                page.wait_for_load_state("networkidle")
                check(page.locator("html").get_attribute("lang") == "he", f'{route}: policy language carried back home')
                language(page, "en")

        section("policy-pages", policies)

        def storage_and_js_baselines():
            for blocked in (False, True):
                fresh = browser.new_context(viewport={"width": 390, "height": 844}, reduced_motion="reduce")
                if blocked:
                    fresh.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Synthetic blocked storage','SecurityError')}})")
                else:
                    fresh.add_init_script("localStorage.setItem('wa-reco-language','xx-invalid')")
                other = fresh.new_page()
                captured = []
                other.on("pageerror", lambda error: captured.append(str(error)))
                for route, selector in (("", '[data-language="en"]'), ("privacy.html", '[data-policy-language="en"]'), ("terms.html", '[data-policy-language="en"]')):
                    other.goto(urljoin(args.url, route), wait_until="networkidle")
                    check(other.locator("html").get_attribute("lang") == "he", f'{route or "homepage"}/storage-{blocked}: Hebrew fallback')
                    other.locator(selector).click()
                    check(other.locator("html").get_attribute("lang") == "en", f'{route or "homepage"}/storage-{blocked}: toggle still works')
                check(not captured, f'blocked-storage-{blocked}: no browser exceptions', captured)
                fresh.close()
            nojs = browser.new_context(java_script_enabled=False, viewport={"width": 320, "height": 844})
            other = nojs.new_page()
            for route in ("", "privacy.html", "terms.html"):
                response = other.goto(urljoin(args.url, route), wait_until="networkidle")
                check(response.status == 200 and len(other.locator("h1").inner_text()) > 4, f'{route or "homepage"}: no-JS readable baseline')
                no_overflow(other, f'{route or "homepage"}/no-JS/320')
            check(other.locator("body").inner_text().strip() != "", "no-JS: policy remains readable")
            nojs.close()

        section("storage-no-js", storage_and_js_baselines)

        check(not page_errors, "no uncaught browser exceptions across actual and fixture cases", page_errors)
        actual_errors = [x for x in console_errors if x["phase"] != "metadata-fixtures"]
        check(not actual_errors, "no console errors during actual-page checks", actual_errors)
        parsed_origin = urlsplit(args.url)
        external = [x for x in requests if urlsplit(x["url"]).netloc not in (parsed_origin.netloc, "")]
        check(not external, "browser requests remain local; no audio/provider/analytics requests", external)
        check(not any(re.search(r'\.(apk|zip)(?:[?#]|$)', item["url"], flags=re.I) for item in requests), "QA does not fetch APK/ZIP artifacts")
        browser.close()

    dist = Path(args.dist)
    manifest = {str(file.relative_to(dist)).replace('\\', '/'): {"bytes": file.stat().st_size, "sha256": hashlib.sha256(file.read_bytes()).hexdigest()} for file in sorted(dist.rglob("*")) if file.is_file()}
    report = {
        "status": "passed" if not failed else "failed",
        "checksPassed": len(passed), "checksFailed": len(failed),
        "checks": passed, "failures": failed,
        "browserErrors": page_errors, "consoleErrors": console_errors,
        "requests": requests, "actualRelease": actual_metadata,
        "sourceManifest": manifest, "screenshots": screenshots,
        "scope": "Local Chromium behavior and rendered layout; synthetic metadata failures; exact public metadata/DOM correspondence. No APK/ZIP byte download, phone, OAuth, Telegram, cloud, credentials, public publication, or audio capture.",
    }
    (output / "validation.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"status": report["status"], "passed": len(passed), "failed": len(failed), "output": str(output), "failureLabels": [item["label"] for item in failed]}, ensure_ascii=False))
    raise SystemExit(0 if not failed else 1)


if __name__ == "__main__":
    main()
