export class PaymentValidationError extends Error {
  readonly status = 422;
  readonly code = "payment_validation";

  constructor(message: string) {
    super(message);
    this.name = "PaymentValidationError";
  }
}

export class PaymentNotFoundError extends Error {
  readonly status = 404;
  readonly code = "payment_not_found";

  constructor(message = "收付款记录不存在") {
    super(message);
    this.name = "PaymentNotFoundError";
  }
}

export class PaymentReadDeniedError extends Error {
  readonly status = 403;
  readonly code = "payment_read_denied";

  constructor() {
    super("当前账号不能查看收付款记录");
    this.name = "PaymentReadDeniedError";
  }
}

export class PaymentWriteDeniedError extends Error {
  readonly status = 403;
  readonly code = "payment_write_denied";

  constructor(message = "当前账号不能登记收款") {
    super(message);
    this.name = "PaymentWriteDeniedError";
  }
}

export class PaymentConflictError extends Error {
  readonly status = 409;
  readonly code = "payment_conflict";

  constructor(message = "收款编号发生冲突，请重试") {
    super(message);
    this.name = "PaymentConflictError";
  }
}
