/** A themed selector overlay that safely nests over the dashboard. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, Input, SelectList, Text, type SelectItem } from "@earendil-works/pi-tui";
export async function selectItem(ctx: ExtensionContext, title: string, items: SelectItem[]): Promise<string | null> {
	if (!items.length) { ctx.ui.notify("No matching items", "info"); return null; }
	return ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder(s => theme.fg("accent", s)));
		container.addChild(new Text(theme.bold(title), 1, 0));
		const list = new SelectList(items, Math.min(items.length, 10), {
			selectedPrefix: s => theme.fg("accent", s), selectedText: s => theme.fg("accent", s),
			description: s => theme.fg("muted", s), scrollInfo: s => theme.fg("dim", s), noMatch: s => theme.fg("warning", s),
		});
		list.onSelect = item => done(item.value); list.onCancel = () => done(null);
		container.addChild(list);
		container.addChild(new Text(theme.fg("dim", "↑↓ select • Enter confirm • Esc cancel"), 1, 0));
		container.addChild(new DynamicBorder(s => theme.fg("accent", s)));
		return { render: width => container.render(width), invalidate: () => container.invalidate(), handleInput: data => { list.handleInput(data); tui.requestRender(); } };
	}, { overlay: true });
}

/** Built-in input dialogs replace Pi's editor; use an overlay inside the dashboard. */
export async function inputText(ctx: ExtensionContext, title: string, initial = ""): Promise<string | undefined> {
	return ctx.ui.custom<string | undefined>((tui, theme, _kb, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder(s => theme.fg("accent", s)));
		container.addChild(new Text(title, 1, 0));
		const input = new Input(); input.setValue(initial);
		input.onSubmit = value => done(value); input.onEscape = () => done(undefined);
		container.addChild(input);
		container.addChild(new Text(theme.fg("dim", "Enter save • Esc cancel"), 1, 0));
		container.addChild(new DynamicBorder(s => theme.fg("accent", s)));
		return {
			get focused() { return input.focused; }, set focused(value: boolean) { input.focused = value; },
			render: width => container.render(width), invalidate: () => container.invalidate(),
			handleInput: data => { input.handleInput(data); tui.requestRender(); },
		};
	}, { overlay: true });
}
export async function confirmItem(ctx: ExtensionContext, title: string, message: string): Promise<boolean> {
	// Destructive prompts default to No.
	return await selectItem(ctx, `${title}\n${message}`, [{ value: "no", label: "No" }, { value: "yes", label: "Yes" }]) === "yes";
}
