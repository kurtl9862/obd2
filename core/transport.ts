/**
 * A byte pipe to an ELM327-style adapter. Every way of reaching the adapter (USB serial,
 * Bluetooth, the Mac helper's WebSocket, the built-in simulator) implements this, so everything
 * above it is the same whatever adapter you plug in.
 */
export interface Transport {
  /** Shown in the UI, e.g. "USB serial" or "Wi-Fi via Mac helper". */
  readonly label: string;
  open(): Promise<void>;
  write(text: string): Promise<void>;
  close(): Promise<void>;
  /** Text as it arrives from the adapter, in arbitrary chunks. */
  onData: ((chunk: string) => void) | null;
  /** The link dropped (unplugged, out of range, helper stopped). */
  onClose: ((reason?: string) => void) | null;
}
