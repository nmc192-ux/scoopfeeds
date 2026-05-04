export class MarketRepository {
  constructor(adapter) {
    this.adapter = adapter;
  }

  findById() {
    throw new Error("MarketRepository is a preparation-only skeleton in this phase");
  }
}
