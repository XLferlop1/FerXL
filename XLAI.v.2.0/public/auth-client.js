(function (globalScope) {
  function createFirebaseAuthClient({
    getCurrentUser = () => (globalScope && globalScope.xlaiAuth ? globalScope.xlaiAuth.getCurrentUser() : null),
    fetchImpl = (url, options) => globalScope.fetch(url, options),
  } = {}) {
    async function getIdToken() {
      const user = getCurrentUser();
      if (!user || typeof user.getIdToken !== "function") {
        const error = new Error("Authentication required. Please sign in with Google.");
        error.code = "authentication_required";
        throw error;
      }

      try {
        return await user.getIdToken();
      } catch (error) {
        const wrapped = new Error("Authentication required. Please sign in with Google.");
        wrapped.code = "authentication_required";
        if (error && error.message) {
          wrapped.cause = error;
          wrapped.originalMessage = error.message;
        }
        throw wrapped;
      }
    }

    async function authenticatedFetch(url, options = {}) {
      const token = await getIdToken();
      const requestOptions = { ...options };
      const headers = new Headers(requestOptions.headers || {});
      headers.set("Authorization", `Bearer ${token}`);
      requestOptions.headers = headers;
      return fetchImpl(url, requestOptions);
    }

    return {
      getIdToken,
      authenticatedFetch,
    };
  }

  globalScope.createFirebaseAuthClient = createFirebaseAuthClient;
  globalScope.authenticatedFetch = (url, options = {}) => {
    if (globalScope.xlaiAuth && typeof globalScope.xlaiAuth.authenticatedFetch === "function") {
      return globalScope.xlaiAuth.authenticatedFetch(url, options);
    }
    return createFirebaseAuthClient().authenticatedFetch(url, options);
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { createFirebaseAuthClient };
  }
})(typeof window !== "undefined" ? window : globalThis);
