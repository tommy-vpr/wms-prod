import { RouterProvider } from "react-router-dom";
import { router } from "./router";

export default function App() {
  return <RouterProvider router={router} />;
}

// import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
// import { ProtectedRoute } from "./components/ProtectedRoute";
// import { Login } from "./pages/auth/Login";
// import { Signup } from "./pages/auth/Signup";
// import { Dashboard } from "./pages/dashboard/Dashboard";
// import { NotFound } from "./pages/NotFound";
// import { useAuth } from "./hooks/useAuth";
// import AdminProductsPage from "./pages/products/_admin-products.page";
// import ProductDetailPage from "./pages/products/_[id]/product-detail.page";
// import ProductImportPage from "./pages/products/_import/product-import.page";
// function AuthRedirect({ children }: { children: React.ReactNode }) {
//   const { isAuthenticated } = useAuth();
//   return isAuthenticated() ? <Navigate to="/" replace /> : <>{children}</>;
// }

// export default function App() {
//   return (
//     <BrowserRouter>
//       <Routes>
//         {/* Public routes */}
//         <Route
//           path="/login"
//           element={
//             <AuthRedirect>
//               <Login />
//             </AuthRedirect>
//           }
//         />
//         <Route
//           path="/signup"
//           element={
//             <AuthRedirect>
//               <Signup />
//             </AuthRedirect>
//           }
//         />

//         <Route path="/products" element={<AdminProductsPage />} />
//         <Route path="/products/import" element={<ProductImportPage />} />
//         <Route path="/products/:id" element={<ProductDetailPage />} />

//         {/* Protected routes */}
//         <Route element={<ProtectedRoute />}>
//           <Route path="/" element={<Dashboard />} />
//         </Route>

//         {/* 404 catch-all */}
//         <Route path="*" element={<NotFound />} />
//       </Routes>
//     </BrowserRouter>
//   );
// }
