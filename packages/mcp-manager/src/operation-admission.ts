import {
	MCP_RUNTIME_CAPACITY_EXCEEDED,
	McpRuntimeManagerError,
	runtimeLeaseModeConflictError,
	runtimeQuarantinedError,
} from "./errors.ts";
import type { McpRuntimeOperationLeaseMode } from "./types.ts";

interface Admission<GenerationKey> {
	readonly generationKey: GenerationKey;
	readonly key: string | undefined;
	readonly mode: McpRuntimeOperationLeaseMode;
}

interface Waiter<GenerationKey> {
	readonly admission: Admission<GenerationKey>;
	grant(): void;
	reject(error: unknown): void;
}

/** Atomic process-local admission; transports and their cleanup remain owned by the manager. */
export class OperationAdmission<GenerationKey> {
	readonly #active = new Set<Admission<GenerationKey>>();
	readonly #waiters = new Set<Waiter<GenerationKey>>();
	readonly #quarantined = new Set<Admission<GenerationKey>>();

	constructor(
		readonly maxOperations: number,
		readonly maxConcurrentOperations: number,
	) {}

	get size(): number {
		return this.#waiters.size;
	}

	hasIsolatedGeneration(generationKey: GenerationKey): boolean {
		return [...this.#active].some(
			(active) => active.generationKey === generationKey && active.mode !== "shared",
		);
	}

	async enter(
		generationKey: GenerationKey,
		mode: McpRuntimeOperationLeaseMode,
		key: string | undefined,
		queue: boolean,
		signal: AbortSignal,
	): Promise<(quarantine: boolean) => void> {
		const admission = { generationKey, mode, key };
		signal.throwIfAborted();
		this.#assertNotQuarantined(admission);
		const conflicts = [...this.#active].filter((active) => this.#related(active, admission));
		// Retained/shared runtimes never participate in isolated admission waiting.
		if (conflicts.some((active) => active.mode === "shared" && mode !== "shared")) {
			throw runtimeLeaseModeConflictError();
		}
		if (this.#available(admission)) {
			this.#active.add(admission);
		} else if (mode === "exclusive" && queue) {
			if (this.#waiters.size >= this.maxOperations) throw this.#capacityError();
			await new Promise<void>((resolve, reject) => {
				const remove = (): void => {
					this.#waiters.delete(waiter);
					signal.removeEventListener("abort", abort);
				};
				const waiter: Waiter<GenerationKey> = {
					admission,
					grant: () => {
						remove();
						resolve();
					},
					reject: (error) => {
						remove();
						reject(error);
					},
				};
				const abort = (): void => {
					waiter.reject(signal.reason);
					this.#drain();
				};
				this.#waiters.add(waiter);
				signal.addEventListener("abort", abort, { once: true });
				if (signal.aborted) abort();
			});
		} else {
			throw mode === "concurrent" ? this.#capacityError() : runtimeLeaseModeConflictError();
		}
		let released = false;
		return (quarantine) => {
			if (released) return;
			released = true;
			if (quarantine) this.#quarantined.add(admission);
			this.#active.delete(admission);
			this.#drain();
		};
	}

	rejectGeneration(generationKey: GenerationKey, reason: unknown): void {
		for (const waiter of this.#waiters) {
			if (waiter.admission.generationKey === generationKey) waiter.reject(reason);
		}
	}

	rejectAll(reason: unknown): void {
		for (const waiter of this.#waiters) waiter.reject(reason);
	}

	#related(left: Admission<GenerationKey>, right: Admission<GenerationKey>): boolean {
		return (
			left.generationKey === right.generationKey ||
			(left.key !== undefined && left.key === right.key)
		);
	}

	#available(admission: Admission<GenerationKey>, pending?: Waiter<GenerationKey>): boolean {
		for (const waiter of this.#waiters) {
			if (waiter === pending) break;
			if (this.#related(waiter.admission, admission)) return false;
		}
		let count = 0;
		for (const active of this.#active) {
			if (!this.#related(active, admission)) continue;
			if (active.mode === "shared" && admission.mode === "shared") continue;
			if (
				active.mode !== "concurrent" ||
				admission.mode !== "concurrent" ||
				active.key !== admission.key
			)
				return false;
			count += 1;
		}
		return count < this.maxConcurrentOperations;
	}

	#assertNotQuarantined(admission: Admission<GenerationKey>): void {
		for (const failed of this.#quarantined) {
			if (this.#related(failed, admission)) throw runtimeQuarantinedError();
		}
	}

	#drain(): void {
		for (const waiter of this.#waiters) {
			try {
				this.#assertNotQuarantined(waiter.admission);
			} catch (error) {
				waiter.reject(error);
				continue;
			}
			if (!this.#available(waiter.admission, waiter)) continue;
			// Reserve before resuming the waiter; new arrivals cannot overtake it.
			this.#active.add(waiter.admission);
			waiter.grant();
		}
	}

	#capacityError(): McpRuntimeManagerError {
		return new McpRuntimeManagerError(
			MCP_RUNTIME_CAPACITY_EXCEEDED,
			"The MCP runtime manager has no compatible operation capacity.",
		);
	}
}
