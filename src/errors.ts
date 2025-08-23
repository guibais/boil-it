export class OperationCancelledError extends Error {
  constructor(message = 'Operation cancelled by user') {
    super(message);
    this.name = 'OperationCancelledError';
  }
}

export function isOperationCancelled(e: unknown): e is OperationCancelledError {
  return e instanceof OperationCancelledError || (!!e && (e as any).name === 'OperationCancelledError');
}
