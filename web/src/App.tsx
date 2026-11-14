import { Link, Route, Routes } from "react-router-dom";
import { Footer } from "./components/Footer";
import { Help } from "./components/Help";
import { ScrollMemory } from "./components/ScrollMemory";
import { SqlDrawer } from "./components/SqlDrawer";
import { TopBar } from "./components/TopBar";
import { ArticlePage } from "./routes/ArticlePage";
import { AskPage } from "./routes/AskPage";
import { Home } from "./routes/Home";
import { ReviewPage } from "./routes/ReviewPage";

// The URL is the state: article, selected paragraph, panel tab and as_of live in it.
export function App() {
  return (
    <div className="app">
      <ScrollMemory />
      <a href="#content" className="skip-link">
        Skip to content
      </a>
      <TopBar />
      <main id="content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/a/:lang/:pageId" element={<ArticlePage />} />
          <Route path="/a/:lang/:pageId/review" element={<ReviewPage />} />
          <Route path="/ask" element={<AskPage />} />
          <Route path="/help" element={<Help />} />
          <Route path="/how" element={<Help />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
      <SqlDrawer />
    </div>
  );
}

function NotFound() {
  return (
    <div className="wrap empty-page">
      <p className="empty-title">There is no page at this address.</p>
      <Link to="/">Back to all articles</Link>
    </div>
  );
}
