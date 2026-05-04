export class EventRepository {
  constructor(adapter) {
    this.adapter = adapter;
  }

  findById() {
    throw new Error("EventRepository is a preparation-only skeleton in this phase");
  }
}
