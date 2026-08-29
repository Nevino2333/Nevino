<script lang="ts">
import { adminRequest } from "./admin-api";
import type {
	ConfigFieldBinding,
	SettingsDiff,
	SettingsGroupDetail,
	SettingsHistoryItem,
	SettingsPublishResult,
} from "./admin-types";

type Props = {
	groupKey: string;
	heading?: string;
	onnotice?: (message: string) => void;
	onerror?: (message: string) => void;
	onpublished?: () => void;
	ondirtychange?: (dirty: boolean) => void;
};

let {
	groupKey,
	heading = "",
	onnotice = () => {},
	onerror = () => {},
	onpublished = () => {},
	ondirtychange = () => {},
}: Props = $props();

let detail = $state<SettingsGroupDetail | null>(null);
let loading = $state(true);
let loadError = $state("");
let saving = $state(false);
let publishing = $state(false);
let fieldErrors = $state<Record<string, string>>({});
let diff = $state<SettingsDiff | null>(null);
let diffOpen = $state(false);
let history = $state<SettingsHistoryItem[] | null>(null);
let historyOpen = $state(false);
let baseline = $state("");

const dirty = $derived(
	detail !== null &&
		baseline !== "" &&
		JSON.stringify({ values: detail.values, code: detail.code }) !== baseline,
);

$effect(() => {
	ondirtychange(dirty);
});

export function canLeaveEditor(): boolean {
	return !dirty || window.confirm("当前分组有未暂存的修改，确定离开吗？");
}

async function load() {
	loading = true;
	loadError = "";
	try {
		detail = await adminRequest<SettingsGroupDetail>(`/settings/${groupKey}`);
		baseline = JSON.stringify({ values: detail.values, code: detail.code });
	} catch (cause) {
		detail = null;
		loadError = cause instanceof Error ? cause.message : "配置加载失败";
		onerror(loadError);
	} finally {
		loading = false;
	}
}

function onWindowKeydown(event: KeyboardEvent) {
	if (event.key === "Escape" && diffOpen) diffOpen = false;
}

function onBeforeUnload(event: BeforeUnloadEvent) {
	if (!dirty) return;
	event.preventDefault();
	event.returnValue = "";
}

const isRef = (value: unknown): boolean =>
	typeof value === "object" &&
	value !== null &&
	!Array.isArray(value) &&
	"$ref" in value;

function setValue(id: string, value: unknown) {
	if (!detail) return;
	const itemMatch = /^(.*)\[(\d+)\]\.([^.]+)$/.exec(id);
	if (itemMatch) {
		setListItem(itemMatch[1], Number(itemMatch[2]), itemMatch[3], value);
		return;
	}
	detail.values = { ...detail.values, [id]: value };
	fieldErrors = { ...fieldErrors, [id]: "" };
}

function setCode(id: string, value: string) {
	if (!detail) return;
	detail.code = { ...detail.code, [id]: value };
}

function setListItem(
	id: string,
	index: number,
	itemKey: string,
	value: unknown,
) {
	if (!detail) return;
	const items = [...((detail.values[id] as unknown[]) ?? [])];
	const item = { ...((items[index] as Record<string, unknown>) ?? {}) };
	item[itemKey] = value;
	items[index] = item;
	detail.values = { ...detail.values, [id]: items };
}

function addItem(binding: ConfigFieldBinding) {
	if (!detail) return;
	const items = [...((detail.values[binding.id] as unknown[]) ?? [])];
	items.push({ ...binding.field.defaultItem });
	detail.values = { ...detail.values, [binding.id]: items };
}

function removeItem(id: string, index: number) {
	if (!detail) return;
	const items = ((detail.values[id] as unknown[]) ?? []).filter(
		(_, current) => current !== index,
	);
	detail.values = { ...detail.values, [id]: items };
}

function moveItem(id: string, index: number, direction: -1 | 1) {
	if (!detail) return;
	const items = [...((detail.values[id] as unknown[]) ?? [])];
	const target = index + direction;
	if (target < 0 || target >= items.length) return;
	const [moved] = items.splice(index, 1);
	items.splice(target, 0, moved);
	detail.values = { ...detail.values, [id]: items };
}

function addTag(id: string, raw: string, maxItems: number) {
	const value = raw.trim();
	if (!value) return;
	const tags = ((detail?.values[id] as string[]) ?? []).slice();
	if (tags.length >= maxItems) return;
	if (!tags.includes(value)) tags.push(value);
	setValue(id, tags);
}

function removeTag(id: string, index: number) {
	const tags = ((detail?.values[id] as string[]) ?? []).filter(
		(_, current) => current !== index,
	);
	setValue(id, tags);
}

async function save() {
	if (!detail) return;
	saving = true;
	fieldErrors = {};
	try {
		detail = await adminRequest<SettingsGroupDetail>(`/settings/${groupKey}`, {
			method: "PUT",
			body: JSON.stringify({
				values: detail.values,
				code: detail.code,
				expectedVersion: detail.version,
			}),
		});
		baseline = JSON.stringify({ values: detail.values, code: detail.code });
		onnotice("修改已暂存，可在差异预览后发布");
	} catch (cause) {
		const error = cause as { fieldErrors?: Record<string, string> };
		fieldErrors = error.fieldErrors ?? {};
		onerror(cause instanceof Error ? cause.message : "暂存失败");
	} finally {
		saving = false;
	}
}

async function discard() {
	if (!detail || !confirm("放弃当前分组的未发布修改？")) return;
	try {
		await adminRequest(`/settings/${groupKey}`, { method: "DELETE" });
		await load();
		onnotice("已放弃未发布修改");
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "操作失败");
	}
}

async function openDiff() {
	try {
		diff = await adminRequest<SettingsDiff>(`/settings/${groupKey}/diff`);
		diffOpen = true;
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "差异加载失败");
	}
}

async function publish() {
	if (!confirm("发布该分组的修改到 GitHub 并触发站点重建？")) return;
	publishing = true;
	try {
		const result = await adminRequest<SettingsPublishResult>(
			"/settings/publish",
			{ method: "POST", body: JSON.stringify({ keys: [groupKey] }) },
		);
		diffOpen = false;
		await load();
		onpublished();
		onnotice(
			result.commitSha
				? "已提交 GitHub（" + result.commitSha.slice(0, 7) + "），等待站点重建"
				: "没有需要发布的文件变更",
		);
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "发布失败");
	} finally {
		publishing = false;
	}
}

async function toggleHistory() {
	historyOpen = !historyOpen;
	if (historyOpen && !history) {
		try {
			const result = await adminRequest<{ items: SettingsHistoryItem[] }>(
				`/settings/${groupKey}/history`,
			);
			history = result.items;
		} catch (cause) {
			onerror(cause instanceof Error ? cause.message : "历史加载失败");
		}
	}
}

async function restore(historyId: string) {
	if (!confirm("将历史版本暂存为当前修改？")) return;
	try {
		detail = await adminRequest<SettingsGroupDetail>(
			`/settings/${groupKey}/restore`,
			{ method: "POST", body: JSON.stringify({ historyId }) },
		);
		baseline = JSON.stringify({ values: detail.values, code: detail.code });
		onnotice("历史版本已暂存，请检查差异后发布");
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "恢复失败");
	}
}

const itemLabel = (binding: ConfigFieldBinding, item: unknown): string => {
	const label = (item as Record<string, unknown>)[binding.field.itemLabelKey];
	return typeof label === "string" && label ? label : "未命名项";
};

$effect(() => {
	void groupKey;
	void load();
});
</script>

<svelte:window onkeydown={onWindowKeydown} onbeforeunload={onBeforeUnload} />

<section class="admin-view">
	<div class="admin-view-heading">
		<div>
			<p class="admin-kicker">{detail ? detail.filePath : groupKey}</p>
			<h2>{heading || detail?.label || groupKey}</h2>
			<p>{detail?.description ?? ""}</p>
		</div>
		<div class="admin-heading-actions">
			<button class="admin-button admin-button-ghost" disabled={!detail} onclick={toggleHistory}>历史</button>
			{#if detail?.staged}
				<button class="admin-button admin-button-ghost" onclick={discard}>放弃修改</button>
				<button class="admin-button" onclick={openDiff}>差异预览</button>
			{/if}
			<button class="admin-button admin-button-primary" disabled={saving || loading || !detail} onclick={save}>{saving ? "保存中…" : "保存暂存"}</button>
		</div>
	</div>

	{#if loading}
		<div class="admin-panel admin-state"><span class="admin-spinner"></span><p>正在读取配置…</p></div>
	{:else if loadError || !detail}
		<div class="admin-panel admin-state admin-state-large admin-error-state">
			<span class="admin-state-icon">!</span>
			<h3>配置加载失败</h3>
			<p>{loadError || "配置不可用"}</p>
			<p class="admin-muted">发布类操作依赖 GitHub 集成；若持续失败，请检查 Cloudflare 环境变量中的 GITHUB_TOKEN 等配置。</p>
			<button class="admin-button admin-button-primary" onclick={load}>重试</button>
		</div>
	{:else if detail}
		{#if detail.parseError}
			<div class="admin-alert admin-error"><span>!</span><div><strong>配置文件解析失败</strong><p>{detail.parseError}</p></div></div>
		{/if}
		{#if detail.stale}
			<div class="admin-alert admin-notice"><span>!</span>远端配置已被更新，当前暂存基于旧版本；重新保存后再发布。</div>
		{/if}
		{#if detail.staged}
			<div class="admin-alert admin-notice"><span>✓</span>有未发布的暂存修改（{detail.stagedAt}）</div>
		{/if}

		<div class="admin-settings-form">
			{#each detail.fields as binding (binding.id)}
				{@render fieldRow(binding, detail.values[binding.id])}
			{/each}
			{#each detail.codeFiles as codeFile (codeFile.id)}
				<div class="admin-field admin-field-wide">
					<label>{codeFile.label}<small>{codeFile.path}</small></label>
					{#if codeFile.help}<p class="admin-field-help">{codeFile.help}</p>{/if}
					<textarea class="admin-code-area" rows="8" value={detail.code[codeFile.id] ?? ""} oninput={(event) => setCode(codeFile.id, event.currentTarget.value)}></textarea>
					{#if fieldErrors[codeFile.id]}<p class="admin-field-error">{fieldErrors[codeFile.id]}</p>{/if}
				</div>
			{/each}
		</div>
	{/if}

	{#if diffOpen && diff}
		<div class="admin-dialog-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) diffOpen = false; }}>
			<div class="admin-dialog" role="dialog" aria-label="差异预览">
				<header class="admin-dialog-head"><h2>差异预览</h2><button class="admin-dialog-close" aria-label="关闭" onclick={() => diffOpen = false}>×</button></header>
				<div class="admin-dialog-body">
					{#each diff.files as file (file.path)}
						<h4>{file.path}</h4>
						<div class="admin-diff">
							{#each file.diff as line, index (index)}
								<div class="admin-diff-line admin-diff-{line.type}">
									<span>{line.oldLine ?? ""}</span><span>{line.newLine ?? ""}</span><code>{line.text}</code>
								</div>
							{/each}
						</div>
					{/each}
				</div>
				<footer class="admin-dialog-foot">
					<button class="admin-button admin-button-ghost" onclick={() => diffOpen = false}>关闭</button>
					<button class="admin-button admin-button-primary" disabled={publishing} onclick={publish}>{publishing ? "发布中…" : "发布到 GitHub"}</button>
				</footer>
			</div>
		</div>
	{/if}

	{#if historyOpen && history}
		<div class="admin-panel admin-history-card">
			<h3>已发布历史</h3>
			{#if history.length === 0}<p class="admin-muted">暂无发布历史。</p>{/if}
			<ul>
				{#each history as item (item.id)}
					<li>
						<span>版本 {item.version}</span>
						<span class="admin-muted">{item.createdAt}{item.commitSha ? " · " + item.commitSha.slice(0, 7) : ""}</span>
						<button class="admin-button admin-button-ghost" onclick={() => restore(item.id)}>暂存此版本</button>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</section>

{#snippet fieldRow(binding: ConfigFieldBinding, value: unknown)}
	{@const field = binding.field}
	<div class="admin-field {field.type === 'textarea' || field.type === 'list' ? 'admin-field-wide' : ''}">
		{#if field.type !== "boolean"}
			<label for="field-{binding.id}">{field.label}</label>
			{#if field.help}<p class="admin-field-help">{field.help}</p>{/if}
		{/if}
		{#if isRef(value)}
			<input id="field-{binding.id}" type="text" value={"引用 " + JSON.stringify(value)} disabled />
		{:else if field.type === "text" || field.type === "url" || field.type === "image" || field.type === "color"}
			<input id="field-{binding.id}" type="text" placeholder={field.placeholder ?? ""} value={typeof value === "string" ? value : ""} oninput={(event) => setValue(binding.id, event.currentTarget.value)} />
		{:else if field.type === "textarea"}
			<textarea id="field-{binding.id}" rows="4" value={typeof value === "string" ? value : ""} oninput={(event) => setValue(binding.id, event.currentTarget.value)}></textarea>
		{:else if field.type === "number"}
			<input id="field-{binding.id}" type="number" min={field.min} max={field.max} step={field.integer ? 1 : "any"} value={typeof value === "number" ? value : 0} oninput={(event) => { const parsed = event.currentTarget.valueAsNumber; setValue(binding.id, Number.isNaN(parsed) ? null : parsed); }} />
		{:else if field.type === "boolean"}
			<label class="admin-check-row">
				<input type="checkbox" checked={value === true} onchange={(event) => setValue(binding.id, event.currentTarget.checked)} />
				<span>{field.label}</span>
				{#if field.help}<small>{field.help}</small>{/if}
			</label>
		{:else if field.type === "select"}
			<select id="field-{binding.id}" value={typeof value === "string" ? value : ""} onchange={(event) => setValue(binding.id, event.currentTarget.value)}>
				{#each field.options as option (option.value)}
					<option value={option.value}>{option.label}</option>
				{/each}
			</select>
		{:else if field.type === "tags"}
			{@render tagsEditor(binding, (value as string[]) ?? [])}
		{:else if field.type === "list"}
			{@render listEditor(binding, (value as Record<string, unknown>[]) ?? [])}
		{/if}
		{#if fieldErrors[binding.id]}<p class="admin-field-error">{fieldErrors[binding.id]}</p>{/if}
	</div>
{/snippet}

{#snippet tagsEditor(binding: ConfigFieldBinding, tags: string[])}
	<div class="admin-tags">
		{#each tags as tag, index (index)}
			<span class="admin-tag">{tag}<button aria-label={"移除 " + tag} onclick={() => removeTag(binding.id, index)}>×</button></span>
		{/each}
		<input
			type="text"
			placeholder="回车添加"
			onkeydown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					addTag(binding.id, event.currentTarget.value, binding.field.maxItems ?? 20);
					event.currentTarget.value = "";
				}
			}}
		/>
	</div>
{/snippet}

{#snippet listEditor(binding: ConfigFieldBinding, items: Record<string, unknown>[])}
	<div class="admin-list">
		{#each items as item, index (index)}
			<div class="admin-list-item">
				<header>
					<strong>{index + 1}. {itemLabel(binding, item)}</strong>
					<div>
						<button aria-label="上移" disabled={index === 0} onclick={() => moveItem(binding.id, index, -1)}>↑</button>
						<button aria-label="下移" disabled={index === items.length - 1} onclick={() => moveItem(binding.id, index, 1)}>↓</button>
						<button aria-label="删除" onclick={() => removeItem(binding.id, index)}>删除</button>
					</div>
				</header>
				<div class="admin-list-fields">
					{#each binding.field.fields as itemField (itemField.key)}
						{@render fieldRow(
							{ id: binding.id + "[" + index + "]." + itemField.key, block: binding.block, path: [], field: itemField },
							item[itemField.key],
						)}
					{/each}
				</div>
			</div>
		{/each}
		<button class="admin-button admin-button-ghost" onclick={() => addItem(binding)}>＋ 添加一项</button>
	</div>
{/snippet}
