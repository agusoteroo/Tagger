/** Error de negocio: mensaje pensado para mostrarle al usuario, con su status HTTP. */
export class ErrorNegocio extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
    this.name = "ErrorNegocio";
  }
}
