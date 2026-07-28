interface ApiKeyUser {
  name: string;
  limit: number;
}

const apiKeys: Record<string, ApiKeyUser> = {
  "12345-abcde": { name: "Free User", limit: 5 },
  "67890-fghij": { name: "Pro User", limit: 20 },
  "admin-key-000": { name: "Admin", limit: 100 },
};

export = apiKeys;
