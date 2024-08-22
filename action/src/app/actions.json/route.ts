import { ACTIONS_CORS_HEADERS, ActionsJson } from "@solana/actions";

export const GET = async () => {
  const payload: ActionsJson = {
    rules: [
      {
        pathPattern: "/",
        apiPath: "/api/actions/donate-sol",
      },
      // fallback route
      {
        pathPattern: "/api/actions/donate-sol",
        apiPath: "/api/actions/donate-sol",
      }
    ],
  };

  return Response.json(payload, {
    headers: ACTIONS_CORS_HEADERS,
  });
};
// ensures cors
export const OPTIONS = GET;