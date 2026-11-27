import { Link } from "react-router-dom";
import { IconArrowLeft } from "../components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center sm:py-28">
      <p className="eyebrow">Error 404</p>
      <h1 className="display mt-3 text-4xl leading-tight sm:text-5xl">This page isn’t in escrow</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-600">
        The page you were looking for doesn’t exist or has moved. Your contracts and funds are untouched.
      </p>
      <Link to="/" className="btn-primary mt-8">
        <IconArrowLeft />
        Back to contracts
      </Link>
    </div>
  );
}
