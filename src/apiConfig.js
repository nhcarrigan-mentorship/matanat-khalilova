const API_BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:8000";

export const clientFetch = async (endpoint, options = {}) => {
  const formattedEndpoint = endpoint.startsWith("/")
    ? endpoint
    : `/${endpoint}`;
  const token = localStorage.getItem("access_token");

  const defaultOptions = {
    ...options,
    headers: {
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };

  const response = await fetch(
    `${API_BASE_URL}${formattedEndpoint}`,
    defaultOptions,
  );
  return response;
};
