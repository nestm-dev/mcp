import { MCP_RUNTIME_CAPACITY_EXCEEDED, McpRuntimeManagerError } from "./errors.ts";

interface ExclusiveWaiter {
	grant(): void;
	reject(reason: unknown): void;
}

/** Bounded admission only; the manager retains ownership of leases, retirement, and cleanup. */
export class ExclusiveOperationQueue<GenerationKey> {
	readonly #waiters = new Map<GenerationKey, Set<ExclusiveWaiter>>();
	readonly maxOperations: number;
	#size = 0;

	constructor(maxOperations: number) {
		this.maxOperations = maxOperations;
	}

	get size(): number {
		return this.#size;
	}

	enqueue(generationKey: GenerationKey, signal: AbortSignal): Promise<void> {
		signal.throwIfAborted();
		if (this.#size >= this.maxOperations) {
			throw new McpRuntimeManagerError(
				MCP_RUNTIME_CAPACITY_EXCEEDED,
				"The MCP runtime manager is at its exclusive operation queue capacity.",
			);
		}
		return new Promise<void>((resolve, reject) => {
			let waiters = this.#waiters.get(generationKey);
			if (waiters === undefined) {
				waiters = new Set();
				this.#waiters.set(generationKey, waiters);
			}
			const remove = (): void => {
				if (!waiters.delete(waiter)) return;
				this.#size -= 1;
				signal.removeEventListener("abort", abort);
				if (waiters.size === 0) this.#waiters.delete(generationKey);
			};
			const waiter: ExclusiveWaiter = {
				grant: () => {
					remove();
					resolve();
				},
				reject: (reason) => {
					remove();
					reject(reason);
				},
			};
			const abort = (): void => waiter.reject(signal.reason);
			waiters.add(waiter);
			this.#size += 1;
			signal.addEventListener("abort", abort, { once: true });
			if (signal.aborted) abort();
		});
	}

	grantNext(generationKey: GenerationKey, reserve: () => void): void {
		const next = this.#waiters.get(generationKey)?.values().next().value;
		if (next === undefined) return;
		// Reserve synchronously so another caller cannot overtake the resumed waiter.
		reserve();
		next.grant();
	}

	rejectGeneration(generationKey: GenerationKey, reason: unknown): void {
		const waiters = this.#waiters.get(generationKey);
		if (waiters === undefined) return;
		for (const waiter of waiters) waiter.reject(reason);
	}

	rejectAll(reason: unknown): void {
		for (const generationKey of this.#waiters.keys()) this.rejectGeneration(generationKey, reason);
	}
}
