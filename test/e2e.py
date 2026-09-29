"""화면 동작 테스트: 로그인부터 모든 메뉴와 주요 작업을 실제 브라우저로 확인"""
import re, sys
from playwright.sync_api import sync_playwright, expect

B = "http://localhost:8899"
OUT = sys.argv[1] if len(sys.argv) > 1 else "."
errors = []

def run(page, label, fn):
    try:
        fn()
        print("OK  ", label)
    except Exception as e:
        print("FAIL", label, "->", str(e).splitlines()[0][:300])
        errors.append(label)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1360, "height": 900}, locale="ko-KR")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    page.on("console", lambda m: m.type == "error" and not re.search(r"fonts\.g|/api/login", (m.location or {}).get("url", "")) and errors.append("console: " + m.text))

    def login():
        page.goto(B + "/")
        page.fill("#login-name", "김민웅")
        page.fill("#login-pw", "틀린비번")
        page.click("button[type=submit]")
        expect(page.locator(".err")).to_contain_text("비밀번호")
        page.fill("#login-pw", "jimi-local-1234")
        page.click("button[type=submit]")
        expect(page.locator("h1")).to_contain_text("오늘 한눈에")
        expect(page.locator("#who")).to_have_text("김민웅 님")
        assert page.get_attribute("#shop-link", "href") == "https://www.jimifnb0901.com"
        assert page.get_attribute("#admin-link", "href").startswith("https://jimifnb0901.cafe24.com/")
    run(page, "로그인", login)

    def home():
        expect(page.locator(".kpi").first).to_be_visible()
        expect(page.locator("svg.chart")).to_be_visible()
        page.screenshot(path=f"{OUT}/01-home.png", full_page=True)
    run(page, "홈 화면", home)

    def examples():
        page.click("a[data-page=settings]")
        expect(page.locator("h1")).to_contain_text("설정·연동")
        page.click("#demo-ex")
        expect(page.locator("h1")).to_contain_text("제품·마진")
        expect(page.locator(".card")).to_have_count(3)
        page.screenshot(path=f"{OUT}/02-products-board.png", full_page=True)
    run(page, "예시 제품 불러오기", examples)

    def product_edit():
        page.locator(".card").filter(has_text="불고기").click()
        expect(page.locator("#d-title")).to_contain_text("불고기")
        before = page.locator("#results .kpi .v").first.inner_text()
        page.fill("#f-price", "39900")
        page.wait_for_timeout(200)
        after = page.locator("#results .kpi .v").first.inner_text()
        assert before != after, (before, after)
        expect(page.locator("#p-save")).to_have_text("저장됨", timeout=4000)
        page.click("[data-add=ingredients]")
        expect(page.locator("[data-arr=ingredients][data-f=name]")).to_have_count(5)
        page.locator("[data-del=ingredients]").last.click()
        page.click("#load-shop")
        expect(page.locator(".map-list label")).to_have_count(4)
        page.screenshot(path=f"{OUT}/03-product-detail.png", full_page=True)
        page.reload()
        expect(page.locator("#f-price")).to_have_value("39900")
    run(page, "제품 편집·자동 저장", product_edit)

    def orders():
        page.goto(B + "/#/orders?group=ready")
        expect(page.locator("h1")).to_contain_text("주문·출고")
        n = page.locator("[data-sel]").count()
        assert n > 0
        page.locator("[data-sel]").first.check()
        page.click("#bulk-ship")
        page.fill("#s-no-0", "612345678901")
        page.click("#s-ok")
        expect(page.locator("#toast")).to_contain_text("송장 1건")
        page.wait_for_timeout(300)
        assert page.locator("[data-sel]").count() == n - 1, "출고 대기에서 빠져야 함"
        page.click("#o-groups button[data-g=all]")
        expect(page.locator("tbody tr").first).to_be_visible()
        href = page.locator("tbody a").first.get_attribute("href")
        assert href.startswith("https://www.jimifnb0901.com/product/detail.html?product_no="), href
        page.screenshot(path=f"{OUT}/04-orders.png", full_page=False)
    run(page, "주문·송장 입력", orders)

    def cs():
        page.click("a[data-page=cs]")
        expect(page.locator("h1")).to_contain_text("CS 문의")
        cnt = page.locator(".cs-item").count()
        page.locator(".cs-item").first.click()
        page.fill("#cs-reply", "[확인 필요: 날짜] 출고 예정입니다.")
        page.click("#cs-send")
        expect(page.locator("#toast")).to_contain_text("확인 필요")
        page.fill("#cs-reply", "안녕하세요, 지미에프앤비입니다. 내일 출고됩니다.")
        page.click("#cs-send")
        page.click("#cb-ok")
        expect(page.locator("#toast")).to_contain_text("등록")
        page.wait_for_timeout(200)
        assert page.locator(".cs-item").count() == cnt - 1
        page.screenshot(path=f"{OUT}/05-cs.png", full_page=False)
    run(page, "CS 답변", cs)

    def sales():
        page.click("a[data-page=sales]")
        expect(page.locator("h1")).to_contain_text("매출 분석")
        expect(page.locator("svg.chart").first).to_be_visible()
        expect(page.locator(".heat")).to_be_visible()
        page.locator("[data-period] button[data-days='7']").click()
        expect(page.locator("#p-from")).to_have_value(re.compile(r"\d{4}-\d{2}-\d{2}"))
        page.locator(".hit").first.hover()
        expect(page.locator("#tip")).to_be_visible()
        page.screenshot(path=f"{OUT}/06-sales.png", full_page=True)
    run(page, "매출 분석", sales)

    def stock():
        page.click("a[data-page=stock]")
        expect(page.locator("h1")).to_contain_text("상품·재고")
        page.locator("tr[data-row]").first.click()
        expect(page.locator(".hbars").first).to_be_visible()
        page.locator("[data-link]").last.click()
        page.select_option("#l-p", index=1)
        page.click("#l-ok")
        expect(page.locator("#toast")).to_contain_text("원가 연결")
    run(page, "상품·재고와 원가 연결", stock)

    def customers():
        page.click("a[data-page=customers]")
        expect(page.locator("h1")).to_contain_text("고객 분석")
        expect(page.locator(".split-bar")).to_be_visible()
        assert page.locator("table tbody tr").count() > 0
    run(page, "고객 분석", customers)

    def fulfillment():
        page.click("a[data-page=fulfillment]")
        expect(page.locator("h1")).to_contain_text("출고 운영")
        with page.expect_download() as dl:
            page.click("#csv-late")
        assert dl.value.suggested_filename.endswith(".csv")
    run(page, "출고 운영·CSV", fulfillment)

    def ads():
        page.click("a[data-page=ads]")
        expect(page.locator("h1")).to_contain_text("광고")
        expect(page.locator("tbody tr")).to_have_count(6)
        page.locator("label.switch").first.click()
        page.click("#cb-ok")
        expect(page.locator("#toast")).to_contain_text("껐습니다")
        page.locator("[data-budget]").first.click()
        page.click("[data-pct='-10']")
        page.click("#b-ok")
        expect(page.locator("#toast")).to_contain_text("예산")
        page.screenshot(path=f"{OUT}/07-ads.png", full_page=True)
    run(page, "광고 켜기/끄기·예산", ads)

    def rules():
        page.click("a[data-page=rules]")
        expect(page.locator("h1")).to_contain_text("자동 규칙")
        page.locator("[data-tpl]").nth(1).click()
        page.click("#e-preview")
        expect(page.locator("#e-prev")).to_contain_text("캠페인")
        page.check("#e-en")
        page.click("#e-save")
        expect(page.locator("#toast")).to_contain_text("저장")
        expect(page.locator("[data-en]")).to_have_count(1)
        page.click("#run-now")
        expect(page.locator(".modal h2")).to_contain_text("모의 실행 결과")
        page.screenshot(path=f"{OUT}/08-rules.png", full_page=True)
        page.click(".modal [data-close]")
    run(page, "자동 규칙 만들기·모의 실행", rules)

    def logpage():
        page.click("a[data-page=log]")
        expect(page.locator("h1")).to_contain_text("변경 이력")
        text = page.locator("table").inner_text()
        for k in ["송장 등록", "CS 답변", "광고 끄기", "예산 변경", "규칙 추가"]:
            assert k in text, k
    run(page, "변경 이력 기록", logpage)

    def mobile():
        m = b.new_context(viewport={"width": 390, "height": 844}, storage_state=ctx.storage_state())
        mp = m.new_page()
        mp.on("pageerror", lambda e: errors.append("mobile pageerror: " + str(e)))
        for h in ["#/home", "#/ads", "#/products"]:
            mp.goto(B + "/" + h)
            mp.wait_for_selector("h1")
            mp.wait_for_timeout(300)
            sw = mp.evaluate("document.documentElement.scrollWidth")
            assert sw <= 392, f"{h} 가로 넘침 {sw}"
        mp.goto(B + "/#/home"); mp.wait_for_selector(".kpi")
        mp.screenshot(path=f"{OUT}/09-mobile-home.png", full_page=True)
        m.close()
    run(page, "휴대폰 화면 폭", mobile)

    def dark():
        d = b.new_context(viewport={"width": 1360, "height": 900}, color_scheme="dark", storage_state=ctx.storage_state())
        dp = d.new_page(); dp.goto(B + "/#/ads"); dp.wait_for_selector("tbody tr")
        dp.screenshot(path=f"{OUT}/10-dark-ads.png")
        d.close()
    run(page, "어두운 화면", dark)

    def logout():
        page.click("#logout")
        expect(page.locator("#login-form")).to_be_visible()
        page.goto(B + "/#/orders")
        expect(page.locator("#login-form")).to_be_visible()
    run(page, "로그아웃", logout)
    b.close()

print("\n문제:", errors if errors else "없음")
sys.exit(1 if errors else 0)
