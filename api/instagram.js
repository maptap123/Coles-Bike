const INSTAGRAM_FIELDS =
  "id,caption,media_type,media_url,permalink,thumbnail_url,timestamp";

function normalizePost(post) {
  const image =
    post.media_type === "VIDEO"
      ? post.thumbnail_url || post.media_url
      : post.media_url || post.thumbnail_url;

  return {
    id: post.id,
    title: post.media_type === "VIDEO" ? "Instagram video" : "Instagram post",
    caption: post.caption || "Latest ride update",
    image,
    url: post.permalink,
    timestamp: post.timestamp,
  };
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const userId = process.env.INSTAGRAM_USER_ID || "me";

  if (!token) {
    return response.status(501).json({
      error: "INSTAGRAM_ACCESS_TOKEN is required to load Instagram posts.",
    });
  }

  try {
    const url = new URL(`https://graph.instagram.com/${userId}/media`);
    url.searchParams.set("fields", INSTAGRAM_FIELDS);
    url.searchParams.set("limit", "4");
    url.searchParams.set("access_token", token);

    const instagramResponse = await fetch(url, { cache: "no-store" });
    const payload = await instagramResponse.json();

    if (!instagramResponse.ok) {
      return response.status(instagramResponse.status).json({
        error: payload.error?.message || "Could not load Instagram posts.",
      });
    }

    response.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=3600");
    return response.status(200).json({
      posts: (payload.data || []).slice(0, 4).map(normalizePost),
    });
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
}
