// Pi web_enable: fresh sessions hide the heavy tools until web_enable.
// DSH restrict() is agent-scoped. startup/clear gate; resume/compact leave tools visible
// because DSH has no Pi toolsAdded transcript to replay the exact set.

const GATED_SOURCES = new Set(["startup", "clear"]);

export function createActivation(toolNames) {
	const restrictions = new WeakMap();
	return {
		toolNames,
		async onCreated(agent, source, restrict) {
			if (!GATED_SOURCES.has(source)) return;
			if (!toolNames.length) return;
			const dispose = restrict({ deny: toolNames });
			restrictions.set(agent, dispose);
		},
		enable(agent) {
			const dispose = restrictions.get(agent);
			if (dispose) {
				dispose();
				restrictions.delete(agent);
			}
			return toolNames;
		},
		isGated(agent) {
			return restrictions.has(agent);
		},
	};
}
