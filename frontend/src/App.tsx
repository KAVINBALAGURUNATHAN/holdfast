import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import ContractDetail from "./pages/ContractDetail";
import Approvals from "./pages/Approvals";
import NotFound from "./pages/NotFound";
import PayPalReturn from "./pages/PayPalReturn";
import PayPalCancel from "./pages/PayPalCancel";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="contracts/:id" element={<ContractDetail />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="paypal/return" element={<PayPalReturn />} />
        <Route path="paypal/cancel" element={<PayPalCancel />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
