import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

export default function Index() {
  const { authed } = useAuth();
  return <Navigate to={authed ? "/dashboard" : "/login"} replace />;
}
