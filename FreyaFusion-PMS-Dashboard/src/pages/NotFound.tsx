import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User tried to access a missing page:",
      location.pathname
    );
  }, [location.pathname]);

  return (
    <div className="flex justify-center items-center min-h-screen bg-background">
      <div className="px-4 text-center">
        <h1 className="mb-2 text-6xl font-extrabold text-primary">404</h1>
        <p className="mb-6 text-2xl text-muted-foreground">
          Sorry, we couldn't find that page.
        </p>
        <span className="inline-block px-3 py-1 mb-6 text-sm rounded shadow bg-accent text-accent-foreground">
          The page <span className="font-mono">{location.pathname}</span> does not exist.
        </span>
        <div>
          <Link
            to="/"
            className="inline-block px-6 py-2 mt-6 font-semibold rounded shadow transition bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Go Home
          </Link>
        </div>
      </div>
    </div>
  );
};

export default NotFound;