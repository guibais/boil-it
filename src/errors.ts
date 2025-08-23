export class OperationCancelledError extends Error {
  constructor(message = 'Operation cancelled by user') {
    super(message);
    this.name = 'OperationCancelledError';
  }
}
