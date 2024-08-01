class APIFeatures {
  constructor(query, queryStr) {
    this.query = query;
    this.queryStr = queryStr;
  }

  searchUser() {
    if (!this.queryStr.keyword) {
      throw new Error("You must provide a keyword.");
    }

    const keyword = {
      $or: [
        { name: { $regex: this.queryStr.keyword, $options: "i" } },
        { email: { $regex: this.queryStr.keyword, $options: "i" } },
      ],
    };

    this.query = this.query.find({ ...keyword });
    return this;
  }

  searchQuestion() {
    if (!this.queryStr.keyword) {
      throw new Error("You must provide a keyword.");
    }

    const keyword = this.queryStr.keyword;

    this.query = this.query.find({
      $or: [
        { title: { $regex: keyword, $options: "i" } }, // Case-insensitive search
        { description: { $regex: keyword, $options: "i" } },
        { relatedSkills: { $regex: keyword, $options: "i" } },
      ],
    });

    return this;
  }
}

module.exports = APIFeatures;
