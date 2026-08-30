import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("Giscus 使用有尺寸的延迟加载锚点而不是空 template", () => {
	const source = fs.readFileSync("src/components/comment/Giscus.astro", "utf8");
	assert.match(source, /<div id="giscus-theme-anchor" class="giscus-lazy-anchor"/);
	assert.match(source, /IntersectionObserver/);
	assert.match(source, /rootMargin: '720px 0px'/);
	assert.doesNotMatch(source, /<template id="giscus-theme-anchor">/);
});
