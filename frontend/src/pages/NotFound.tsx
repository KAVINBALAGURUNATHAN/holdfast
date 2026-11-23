import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <p className="text-sm font-semibold text-accent-700">404</p>
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">Page not found</h1>
      <Link to="/" className="btn-secondary mt-6">
        Back to contracts
      </Link>
    </div>
  );
}
