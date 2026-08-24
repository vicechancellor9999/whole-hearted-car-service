export class BusinessOrderReadDeniedError extends Error {
  readonly status = 403;
  readonly code = "business_order_read_denied";
  constructor() {
    super("当前账号不能查看 Business Order");
    this.name = "BusinessOrderReadDeniedError";
  }
}

export class BusinessOrderWriteDeniedError extends Error {
  readonly status = 403;
  readonly code = "business_order_write_denied";
  constructor() {
    super("老板账号为全部只读，不能修改 Business Order");
    this.name = "BusinessOrderWriteDeniedError";
  }
}

export class BusinessOrderNotFoundError extends Error {
  readonly status = 404;
  readonly code = "business_order_not_found";
  constructor(message = "Business Order 不存在") {
    super(message);
    this.name = "BusinessOrderNotFoundError";
  }
}

export class BusinessOrderConflictError extends Error {
  readonly status = 409;
  readonly code = "business_order_conflict";
  constructor(message = "Business Order 已被其他操作修改，请刷新后重试") {
    super(message);
    this.name = "BusinessOrderConflictError";
  }
}

export class BusinessOrderValidationError extends Error {
  readonly status = 422;
  readonly code = "business_order_validation";
  constructor(message: string) {
    super(message);
    this.name = "BusinessOrderValidationError";
  }
}
