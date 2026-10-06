/**
 * 壁纸批量压缩：等比缩放到最大宽度 2048（仅缩小，不放大），重新编码为 webp。
 *
 * 背景：public/assets/images/wallpaper/ 下积累了一批 4K 源（最大 3840x2160 / 1.7MB），
 * 全部以原始尺寸随站点发布，且被 Service Worker 无上限缓存。而壁纸实际用途是
 * banner 背景图（上方还有遮罩与动画），1920~2048 宽已经足够。
 *
 * 安全性：
 * - 默认 dry-run，只报告不写盘；加 --apply 才真正替换。
 * - 逐张「先写临时文件、校验体积更小、再原子替换」，任何一张失败都不影响其它。
 * - 原图已纳入 git 版本控制，可随时 `git checkout -- public/assets/images/wallpaper/` 回滚。
 *
 * 用法：
 *   node scripts/compress-wallpapers.mjs            # dry-run
 *   node scripts/compress-wallpapers.mjs --apply    # 实际执行
 */
import { existsSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const WALLPAPER_DIR = "public/assets/images/wallpaper";
const MAX_WIDTH = 2048;
const QUALITY = 80;

const apply = process.argv.includes("--apply");

const dir = fileURLToPath(new URL("../", import.meta.url));
const wallpaperDir = join(dir, WALLPAPER_DIR);

if (!existsSync(wallpaperDir)) {
	console.error(`目录不存在: ${WALLPAPER_DIR}`);
	process.exit(1);
}

const files = (await readdir(wallpaperDir))
	.filter((f) => f.toLowerCase().endsWith(".webp"))
	.map((f) => join(wallpaperDir, f))
	.sort();

let totalBefore = 0;
let totalAfter = 0;
let resized = 0;
let skipped = 0;
let failed = 0;

console.log(
	`${apply ? "[APPLY]" : "[DRY-RUN]"} 共 ${files.length} 张 | 目标最大宽度 ${MAX_WIDTH}px | webp 质量 ${QUALITY}\n`,
);

for (const file of files) {
	const before = statSync(file).size;
	totalBefore += before;

	try {
		const source = await readFile(file);
		const meta = await sharp(source).metadata();
		const width = meta.width ?? 0;

		// 宽度未超标，且体积已经在合理范围（<400KB）内，保持原样不动
		if (width <= MAX_WIDTH && before < 400 * 1024) {
			totalAfter += before;
			skipped++;
			continue;
		}

		const pipeline = sharp(source, { failOn: "none" });
		if (width > MAX_WIDTH) {
			pipeline.resize({ width: MAX_WIDTH, withoutEnlargement: true });
		}

		const output = await pipeline
			.webp({ quality: QUALITY, effort: 5, smartSubsample: true })
			.toBuffer();

		const after = output.length;
		totalAfter += after;

		// 只在新文件确实更小时才替换，避免负优化
		if (after >= before) {
			skipped++;
			console.log(
				`  跳过 ${basename(file)} — 压缩后 ${(after / 1024).toFixed(0)}KB 不小于原图 ${(before / 1024).toFixed(0)}KB`,
			);
			continue;
		}

		resized++;
		const pct = ((1 - after / before) * 100).toFixed(0);
		console.log(
			`  ${basename(file).padEnd(24)} ${width}x${meta.height ?? "?"} ${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(0)}KB  (-${pct}%)`,
		);

		if (apply) {
			const tmp = `${file}.tmp-compress`;
			writeFileSync(tmp, output);
			// 原子替换：先备份原图为 .bak，成功后再删除
			const bak = `${file}.bak`;
			renameSync(file, bak);
			try {
				renameSync(tmp, file);
				unlinkSync(bak);
			} catch (err) {
				// 替换失败则还原
				if (existsSync(bak) && !existsSync(file)) renameSync(bak, file);
				throw err;
			}
		}
	} catch (err) {
		failed++;
		console.error(`  失败 ${basename(file)}: ${err.message}`);
	}
}

const mb = (n) => (n / 1024 / 1024).toFixed(1);
const pct = totalBefore ? ((1 - totalAfter / totalBefore) * 100).toFixed(0) : 0;

console.log(`\n———— 汇总 ————`);
console.log(`原总大小   ${mb(totalBefore)} MB`);
console.log(`处理后     ${mb(totalAfter)} MB  (节省 ${pct}%)`);
console.log(`重编码 ${resized} 张 / 跳过 ${skipped} 张 / 失败 ${failed} 张`);

if (!apply) {
	console.log(`\n这是 dry-run，未写入任何文件。确认无误后执行：`);
	console.log(`  node scripts/compress-wallpapers.mjs --apply`);
}

// 清理可能残留的临时文件
for (const file of files) {
	for (const suffix of [".tmp-compress", ".bak"]) {
		const p = `${file}${suffix}`;
		if (existsSync(p)) await rm(p, { force: true });
	}
}
