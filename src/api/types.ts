export interface Source {
  id: string;
  name: string;
  handle: string;
  image?: string | null;
}

export interface Author {
  id?: string | null;
  name?: string | null;
  image?: string | null;
}

export interface FeedPost {
  id: string;
  title: string;
  url: string;
  image?: string | null;
  summary?: string | null;
  type: string;
  publishedAt?: string | null;
  createdAt: string;
  commentsPermalink: string;
  source: Source;
  tags: string[];
  readTime?: number | null;
  numUpvotes: number;
  numComments: number;
  author?: Author;
}

export interface Pagination {
  cursor?: string | null;
  hasMore?: boolean;
}

export interface FeedResponse {
  data: FeedPost[];
  pagination?: Pagination;
}

export interface Tag {
  name: string;
}

export interface TagsResponse {
  data: Tag[];
}

export interface SourcesSearchResponse {
  data: Source[];
}

export type TimeRange = "day" | "week" | "month" | "year" | "all";

export interface FeedOptions {
  limit?: number;
  cursor?: string;
  tags?: string;
  tag?: string;
  source?: string;
  period?: number;
}

export interface RecommendOptions {
  q: string;
  limit?: number;
  time?: TimeRange;
  cursor?: string;
}
