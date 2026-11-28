import { Link, useSearchParams } from "react-router-dom";
import { IconArrowLeft, IconX } from "../components/ui";
import { PaymentShell } from "./PayPalReturn";

export default function PayPalCancel() {
  const [params] = useSearchParams();
  const contractId = params.get("contract_id");

  return (
    <PaymentShell icon={<IconX className="h-5 w-5" />} eyebrow="PayPal sandbox" title="Payment cancelled">
      <p>Nothing was charged and no escrow was created. You can fund the milestone again whenever you're ready.</p>
      <div className="mt-6 flex flex-wrap gap-2">
        {contractId ? (
          <Link to={`/contracts/${encodeURIComponent(contractId)}`} className="btn-primary">
            <IconArrowLeft />
            Back to the contract
          </Link>
        ) : (
          <Link to="/" className="btn-secondary">
            <IconArrowLeft />
            Back to contracts
          </Link>
        )}
      </div>
    </PaymentShell>
  );
}
