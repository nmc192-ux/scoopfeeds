export class UserRepository {
  constructor(adapter) {
    this.adapter = adapter;
  }

  findById() {
    throw new Error("UserRepository is a preparation-only skeleton in this phase");
  }
}
