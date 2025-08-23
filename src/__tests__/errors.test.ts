import { OperationCancelledError } from '../errors';

describe('OperationCancelledError', () => {
  it('should set name and default message', () => {
    const err = new OperationCancelledError();
    expect(err.name).toBe('OperationCancelledError');
    expect(err.message).toBe('Operation cancelled by user');
  });

  it('should accept custom message', () => {
    const err = new OperationCancelledError('x');
    expect(err.message).toBe('x');
  });
});
