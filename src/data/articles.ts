export interface ArticleSection {
  type: 'heading' | 'paragraph' | 'list' | 'callout';
  heading?: string;
  text?: string;
  items?: string[];
  calloutType?: 'tip' | 'warning' | 'info';
}

export interface BlogArticle {
  slug: string;
  title: string;
  description: string;
  category: string;
  publishedAt: string;
  readingTime: number;
  content: ArticleSection[];
  tags: string[];
}

export const articles: BlogArticle[] = [];
