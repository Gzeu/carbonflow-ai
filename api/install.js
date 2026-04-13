// GET /api/install — redirect to GitHub App installation page
export default function handler(req, res) {
  const appSlug = process.env.GITHUB_APP_SLUG || 'carbonflow-ai-tracker';
  const installUrl = `https://github.com/apps/${appSlug}/installations/new`;
  res.setHeader('Location', installUrl);
  return res.status(302).end();
}
