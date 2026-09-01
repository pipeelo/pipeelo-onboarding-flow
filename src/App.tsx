import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import NovoOnboarding from "./pages/NovoOnboarding";
import Onboarding from "./pages/Onboarding";
import OnboardingSession from "./pages/OnboardingSession";
import AdminOnboarding from "./pages/AdminOnboarding";
import ComercialEntry from "./pages/ComercialEntry";
import Cadastro from "./pages/Cadastro";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* Raiz não tem página própria — uso real é sempre /admin ou link de sessão */}
          <Route path="/" element={<Navigate to="/admin" replace />} />
          <Route path="/novo" element={<NovoOnboarding />} />
          <Route path="/admin" element={<AdminOnboarding />} />
          <Route path="/comercial/:slug" element={<ComercialEntry />} />
          <Route path="/cadastro/:slug" element={<Cadastro />} />
          <Route path="/:slug" element={<OnboardingSession />} />
          <Route path="/:slug/:departamento" element={<Onboarding />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
