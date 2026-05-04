export class ArticleRepository {
  constructor(adapter) {
    this.adapter = adapter;
  }

  findById() {
    throw new Error("ArticleRepository is a preparation-only skeleton in this phase");
  }
}
