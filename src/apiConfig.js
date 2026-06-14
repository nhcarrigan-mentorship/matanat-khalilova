const API_BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:8000";

export const clientFetch = async (endpoint, options = {}) => {
  // Ensure the endpoint starts with a slash
  const formattedEndpoint = endpoint.startsWith("/")
    ? endpoint
    : `/${endpoint}`;

  // Automatically pass along cookies/credentials for auth sessions
  const defaultOptions = {
    credentials: "include",
    ...options,
  };

  const response = await fetch(
    `${API_BASE_URL}${formattedEndpoint}`,
    defaultOptions,
  );
  return response;
};
