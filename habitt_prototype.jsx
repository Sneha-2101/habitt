import React, { useState, useMemo } from "react";
import { X, Plus, Minus, Trash2, Check, ArrowRight, ArrowLeft, Pencil, Lock } from "lucide-react";

const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,500&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
`;

const COLORS = {
  paper: "#F5F2EC",
  card: "#FBF9F5",
  ink: "#1D1B18",
  moss: "#545A3E",
  clay: "#A8492F",
  stone: "#DAD3C4",
  stoneDark: "#B7AF9C",
};

const CATEGORIES = ["All", "Shirts", "Overshirts", "Polos", "Trousers"];

const seedProducts = [
  { id: "P001", name: "Oxford Weave Shirt", category: "Shirts", price: 2490, stock: 14, swatch: "#C9BFA8", tag: "SAND" },
  { id: "P002", name: "Brushed Twill Overshirt", category: "Overshirts", price: 4290, stock: 6, swatch: "#5B5548", tag: "OLIVE" },
  { id: "P003", name: "Piqué Knit Polo", category: "Polos", price: 1890, stock: 22, swatch: "#3F4A3D", tag: "MOSS" },
  { id: "P004", name: "Tapered Cotton Trouser", category: "Trousers", price: 2990, stock: 9, swatch: "#2B2926", tag: "INK" },
  { id: "P005", name: "Garment-Dyed Shirt", category: "Shirts", price: 2690, stock: 11, swatch: "#8B6F56", tag: "CLAY" },
  { id: "P006", name: "Wool-Blend Overshirt", category: "Overshirts", price: 4990, stock: 4, swatch: "#4A4437", tag: "STONE" },
  { id: "P007", name: "Textured Rib Polo", category: "Polos", price: 1990, stock: 17, swatch: "#8A9078", tag: "SAGE" },
  { id: "P008", name: "Straight Chino", category: "Trousers", price: 2790, stock: 13, swatch: "#B7AF9C", tag: "STONE" },
];

const seedOrders = [
  { id: "HB-10231", customer: "Rohan Mehta", total: 6180, status: "Paid", items: 2 },
  { id: "HB-10230", customer: "Isha Kapoor", total: 2990, status: "Paid", items: 1 },
  { id: "HB-10229", customer: "Aditya Rao", total: 4290, status: "Pending", items: 1 },
];

function formatINR(n) {
  return "₹" + n.toLocaleString("en-IN");
}

function CareTag({ children, dark }) {
  return (
    <span
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
        letterSpacing: "0.08em",
        padding: "3px 8px",
        border: `1px solid ${dark ? COLORS.paper : COLORS.ink}`,
        color: dark ? COLORS.paper : COLORS.ink,
        opacity: 0.75,
      }}
    >
      {children}
    </span>
  );
}

function ProductSwatch({ color, size = "100%" }) {
  return (
    <div
      style={{
        width: "100%",
        aspectRatio: "4 / 5",
        background: `linear-gradient(155deg, ${color} 0%, ${color}CC 55%, ${COLORS.card} 150%)`,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "repeating-linear-gradient(115deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px, transparent 1px, transparent 14px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "38%",
          left: 0,
          right: 0,
          height: 1,
          background: "rgba(255,255,255,0.35)",
          transform: "rotate(-2deg)",
        }}
      />
    </div>
  );
}

export default function Habitt() {
  const [view, setView] = useState("store"); // store | admin
  const [products, setProducts] = useState(seedProducts);
  const [orders] = useState(seedOrders);
  const [category, setCategory] = useState("All");
  const [cart, setCart] = useState([]); // {id, size, qty}
  const [selected, setSelected] = useState(null);
  const [selectedSize, setSelectedSize] = useState("M");
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState(0); // 0 store, 1 details, 2 paying, 3 success
  const [orderId, setOrderId] = useState(null);
  const [editingProduct, setEditingProduct] = useState(null);
  const [adminTab, setAdminTab] = useState("products");

  // Unified auth mock: one login for everyone. Typing "admin" as the email
  // signs in as staff (shows the "admin" header link + unlocks /admin);
  // anything else signs in as an ordinary customer.
  const [session, setSession] = useState(null); // null | { role: "CUSTOMER" | "STAFF" }
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const isStaff = session?.role === "STAFF";

  const filtered = useMemo(
    () => (category === "All" ? products : products.filter((p) => p.category === category)),
    [category, products]
  );

  const cartDetailed = cart.map((c) => ({ ...c, product: products.find((p) => p.id === c.id) }));
  const subtotal = cartDetailed.reduce((s, c) => s + (c.product?.price || 0) * c.qty, 0);

  function addToCart(product, size) {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === product.id && c.size === size);
      if (existing) return prev.map((c) => (c === existing ? { ...c, qty: c.qty + 1 } : c));
      return [...prev, { id: product.id, size, qty: 1 }];
    });
    setCartOpen(true);
    setSelected(null);
  }

  function updateQty(id, size, delta) {
    setCart((prev) =>
      prev
        .map((c) => (c.id === id && c.size === size ? { ...c, qty: c.qty + delta } : c))
        .filter((c) => c.qty > 0)
    );
  }

  function removeFromCart(id, size) {
    setCart((prev) => prev.filter((c) => !(c.id === id && c.size === size)));
  }

  function placeOrder() {
    setCheckoutStep(2);
    setTimeout(() => {
      setOrderId("HB-" + Math.floor(10000 + Math.random() * 89999));
      setCheckoutStep(3);
      setCart([]);
    }, 1600);
  }

  function saveProduct(p) {
    setProducts((prev) => {
      const exists = prev.some((x) => x.id === p.id);
      return exists ? prev.map((x) => (x.id === p.id ? p : x)) : [p, ...prev];
    });
    setEditingProduct(null);
  }

  function deleteProduct(id) {
    setProducts((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div style={{ background: COLORS.paper, minHeight: "100%", color: COLORS.ink, fontFamily: "'Inter', sans-serif" }}>
      <style>{FONTS}</style>

      {/* HEADER — three columns: left nav / centered icon+wordmark / right nav.
          "admin" only appears once signed in as staff; there is no separate
          admin button otherwise, and /admin (the `view==="admin"` state here)
          is reached only via that link or by an already-staff session. */}
      <header
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          padding: "16px 28px",
          borderBottom: `1px solid ${COLORS.stone}`,
          position: "sticky",
          top: 0,
          background: COLORS.paper,
          zIndex: 20,
        }}
      >
        <nav style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 12.5, letterSpacing: "0.02em", textTransform: "lowercase" }}>
          <button onClick={() => { setView("store"); setCheckoutStep(0); }} style={{ background: "none", border: "none", cursor: "pointer", color: COLORS.ink }}>shop</button>
          <span style={{ color: COLORS.stoneDark, cursor: "default" }}>journal</span>
          <span style={{ color: COLORS.stoneDark, cursor: "default" }}>about</span>
        </nav>

        <div
          style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", justifySelf: "center" }}
          onClick={() => { setView("store"); setCheckoutStep(0); }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={COLORS.ink} strokeWidth="1.4">
            <path d="M4 20V11a8 8 0 0 1 16 0v9" />
          </svg>
          <span style={{ fontSize: 16, textTransform: "lowercase", letterSpacing: "0.01em" }}>habitt</span>
        </div>

        <nav style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 20, fontSize: 12.5, letterSpacing: "0.02em", textTransform: "lowercase" }}>
          <span style={{ color: COLORS.stoneDark, cursor: "default" }}>search</span>
          {isStaff && (
            <button
              onClick={() => setView("admin")}
              style={{ background: "none", border: "none", cursor: "pointer", color: COLORS.moss, fontSize: 12.5, textTransform: "lowercase" }}
            >
              admin
            </button>
          )}
          <button
            onClick={() => (session ? setSession(null) : setLoginOpen(true))}
            style={{ background: "none", border: "none", cursor: "pointer", color: COLORS.ink, fontSize: 12.5, textTransform: "lowercase" }}
          >
            {session ? "sign out" : "account"}
          </button>
          <button
            onClick={() => (session ? setCartOpen(true) : setLoginOpen(true))}
            style={{ background: "none", border: "none", cursor: "pointer", color: COLORS.ink, fontSize: 12.5, textTransform: "lowercase", display: "flex", alignItems: "center" }}
          >
            cart
            {cart.length > 0 && (
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: COLORS.moss, display: "inline-block", marginLeft: 4 }} />
            )}
          </button>
        </nav>
      </header>

      {view === "store" && checkoutStep === 0 && (
        <>
          {/* HERO */}
          <section style={{ position: "relative", padding: "72px 28px 56px", overflow: "hidden" }}>
            <div
              style={{
                position: "absolute",
                top: "40%",
                left: "-5%",
                right: "-5%",
                height: 1,
                background: COLORS.stoneDark,
                transform: "rotate(-3deg)",
              }}
            />
            <p
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                letterSpacing: "0.12em",
                color: COLORS.moss,
                marginBottom: 14,
              }}
            >
              A/W COLLECTION — MADE TO WEAR IN
            </p>
            <h1
              style={{
                fontFamily: "'Fraunces', serif",
                fontStyle: "italic",
                fontWeight: 500,
                fontSize: "clamp(36px, 6vw, 68px)",
                lineHeight: 1.02,
                maxWidth: 760,
                margin: 0,
              }}
            >
              Clothes with a quiet weight to them.
            </h1>
            <p style={{ maxWidth: 460, marginTop: 20, fontSize: 15, color: "#4B473F", lineHeight: 1.6 }}>
              Habitt makes considered basics — heavier fabrics, honest fits, nothing shouting for
              attention. Free shipping over ₹2,999.
            </p>
          </section>

          {/* CATEGORY CHIPS */}
          <div style={{ display: "flex", gap: 8, padding: "0 28px 28px", flexWrap: "wrap" }}>
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 999,
                  border: `1px solid ${category === c ? COLORS.ink : COLORS.stone}`,
                  background: category === c ? COLORS.ink : "transparent",
                  color: category === c ? COLORS.paper : COLORS.ink,
                  fontSize: 12.5,
                  letterSpacing: "0.02em",
                  cursor: "pointer",
                }}
              >
                {c}
              </button>
            ))}
          </div>

          {/* PRODUCT GRID */}
          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 22,
              padding: "0 28px 72px",
            }}
          >
            {filtered.map((p) => (
              <div
                key={p.id}
                onClick={() => {
                  setSelected(p);
                  setSelectedSize("M");
                }}
                style={{ cursor: "pointer", background: COLORS.card }}
              >
                <ProductSwatch color={p.swatch} />
                <div style={{ padding: "12px 4px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{p.name}</div>
                      <div style={{ fontSize: 12, color: COLORS.stoneDark, marginTop: 2 }}>{p.category}</div>
                    </div>
                    <CareTag>{p.tag}</CareTag>
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, marginTop: 8 }}>
                    {formatINR(p.price)}
                  </div>
                </div>
              </div>
            ))}
          </section>
        </>
      )}

      {/* PRODUCT DETAIL DRAWER */}
      {selected && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(29,27,24,0.4)",
            zIndex: 40,
            display: "flex",
            justifyContent: "flex-end",
          }}
          onClick={() => setSelected(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(420px, 100%)",
              background: COLORS.paper,
              height: "100%",
              overflowY: "auto",
              padding: 28,
            }}
          >
            <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", cursor: "pointer" }}>
              <X size={20} />
            </button>
            <div style={{ marginTop: 16 }}>
              <ProductSwatch color={selected.swatch} />
            </div>
            <div style={{ marginTop: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <h2 style={{ fontFamily: "'Fraunces', serif", fontWeight: 500, fontSize: 24, margin: 0 }}>
                  {selected.name}
                </h2>
                <CareTag>{selected.tag}</CareTag>
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, marginTop: 10 }}>
                {formatINR(selected.price)}
              </div>
              <p style={{ fontSize: 13.5, color: "#4B473F", marginTop: 14, lineHeight: 1.6 }}>
                Heavyweight cotton, garment-washed for a broken-in feel from day one. Cut with a
                relaxed shoulder and a straight body.
              </p>
              <div style={{ marginTop: 22 }}>
                <div style={{ fontSize: 11, letterSpacing: "0.08em", color: COLORS.stoneDark, marginBottom: 8 }}>
                  SIZE
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {["S", "M", "L", "XL"].map((s) => (
                    <button
                      key={s}
                      onClick={() => setSelectedSize(s)}
                      style={{
                        width: 42,
                        height: 42,
                        border: `1px solid ${selectedSize === s ? COLORS.ink : COLORS.stone}`,
                        background: selectedSize === s ? COLORS.ink : "transparent",
                        color: selectedSize === s ? COLORS.paper : COLORS.ink,
                        cursor: "pointer",
                        fontSize: 13,
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={() => addToCart(selected, selectedSize)}
                style={{
                  marginTop: 26,
                  width: "100%",
                  padding: "14px 0",
                  background: COLORS.ink,
                  color: COLORS.paper,
                  border: "none",
                  fontSize: 13,
                  letterSpacing: "0.06em",
                  cursor: "pointer",
                }}
              >
                ADD TO BAG
              </button>
              <div style={{ marginTop: 10, fontSize: 11.5, color: COLORS.stoneDark }}>
                {selected.stock} in stock · Free shipping over ₹2,999
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CART DRAWER */}
      {cartOpen && checkoutStep === 0 && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(29,27,24,0.4)", zIndex: 40, display: "flex", justifyContent: "flex-end" }}
          onClick={() => setCartOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(400px, 100%)", background: COLORS.paper, height: "100%", display: "flex", flexDirection: "column", padding: 28 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontFamily: "'Fraunces', serif", fontSize: 20, margin: 0 }}>Your Bag</h3>
              <button onClick={() => setCartOpen(false)} style={{ background: "none", border: "none", cursor: "pointer" }}>
                <X size={20} />
              </button>
            </div>
            <div style={{ marginTop: 20, flex: 1, overflowY: "auto" }}>
              {cartDetailed.length === 0 && (
                <p style={{ color: COLORS.stoneDark, fontSize: 13.5 }}>Your bag is empty. Time to fix that.</p>
              )}
              {cartDetailed.map((c) => (
                <div key={c.id + c.size} style={{ display: "flex", gap: 12, marginBottom: 18, borderBottom: `1px solid ${COLORS.stone}`, paddingBottom: 18 }}>
                  <div style={{ width: 64, height: 78, background: c.product?.swatch, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <div style={{ fontSize: 13.5, fontWeight: 500 }}>{c.product?.name}</div>
                      <button onClick={() => removeFromCart(c.id, c.size)} style={{ background: "none", border: "none", cursor: "pointer", color: COLORS.stoneDark }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div style={{ fontSize: 11.5, color: COLORS.stoneDark, marginTop: 2 }}>Size {c.size}</div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, border: `1px solid ${COLORS.stone}`, padding: "2px 8px" }}>
                        <button onClick={() => updateQty(c.id, c.size, -1)} style={{ background: "none", border: "none", cursor: "pointer" }}><Minus size={12} /></button>
                        <span style={{ fontSize: 12 }}>{c.qty}</span>
                        <button onClick={() => updateQty(c.id, c.size, 1)} style={{ background: "none", border: "none", cursor: "pointer" }}><Plus size={12} /></button>
                      </div>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5 }}>
                        {formatINR((c.product?.price || 0) * c.qty)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {cartDetailed.length > 0 && (
              <div style={{ borderTop: `1px solid ${COLORS.stone}`, paddingTop: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 14 }}>
                  <span>Subtotal</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{formatINR(subtotal)}</span>
                </div>
                <button
                  onClick={() => {
                    if (!session) {
                      setCartOpen(false);
                      setLoginOpen(true);
                      return;
                    }
                    setCartOpen(false);
                    setCheckoutStep(1);
                  }}
                  style={{ width: "100%", padding: "14px 0", background: COLORS.ink, color: COLORS.paper, border: "none", fontSize: 13, letterSpacing: "0.06em", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                >
                  {session ? "CHECKOUT" : "SIGN IN TO CHECK OUT"} <ArrowRight size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CHECKOUT FLOW */}
      {checkoutStep === 1 && (
        <section style={{ maxWidth: 520, margin: "0 auto", padding: "56px 28px" }}>
          <button onClick={() => setCheckoutStep(0)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: COLORS.stoneDark, marginBottom: 24 }}>
            <ArrowLeft size={14} /> Back to shop
          </button>
          <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 26, marginBottom: 24 }}>Checkout</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
            {["Full name", "Phone number", "Delivery address", "Pincode"].map((ph) => (
              <input
                key={ph}
                placeholder={ph}
                style={{ padding: "12px 14px", border: `1px solid ${COLORS.stone}`, background: COLORS.card, fontSize: 13.5, fontFamily: "inherit" }}
              />
            ))}
          </div>
          <div style={{ background: COLORS.card, padding: 18, border: `1px solid ${COLORS.stone}`, marginBottom: 24 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.08em", color: COLORS.stoneDark, marginBottom: 10 }}>ORDER SUMMARY</div>
            {cartDetailed.map((c) => (
              <div key={c.id + c.size} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                <span>{c.product?.name} × {c.qty}</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{formatINR((c.product?.price || 0) * c.qty)}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 600, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${COLORS.stone}` }}>
              <span>Total</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{formatINR(subtotal)}</span>
            </div>
          </div>
          <button
            onClick={placeOrder}
            style={{ width: "100%", padding: "15px 0", background: "#072654", color: "#fff", border: "none", fontSize: 13.5, letterSpacing: "0.04em", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}
          >
            Pay {formatINR(subtotal)} with Razorpay
          </button>
          <p style={{ fontSize: 11, color: COLORS.stoneDark, marginTop: 10, textAlign: "center" }}>
            Demo checkout — no real payment is processed. In production this opens the Razorpay
            Checkout modal via a server-created order.
          </p>
        </section>
      )}

      {checkoutStep === 2 && (
        <section style={{ maxWidth: 420, margin: "0 auto", padding: "120px 28px", textAlign: "center" }}>
          <div style={{ width: 36, height: 36, border: `3px solid ${COLORS.stone}`, borderTopColor: COLORS.ink, borderRadius: "50%", margin: "0 auto 20px", animation: "spin 0.8s linear infinite" }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <p style={{ fontSize: 13.5, color: COLORS.stoneDark }}>Confirming payment with Razorpay…</p>
        </section>
      )}

      {checkoutStep === 3 && (
        <section style={{ maxWidth: 460, margin: "0 auto", padding: "100px 28px", textAlign: "center" }}>
          <div style={{ width: 52, height: 52, borderRadius: "50%", background: COLORS.moss, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
            <Check color={COLORS.paper} size={26} />
          </div>
          <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 24, marginBottom: 10 }}>Order placed</h2>
          <p style={{ fontSize: 13.5, color: "#4B473F", marginBottom: 6 }}>Order ID</p>
          <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 15, marginBottom: 24 }}>{orderId}</p>
          <button
            onClick={() => {
              setCheckoutStep(0);
              setView("store");
            }}
            style={{ padding: "12px 28px", background: COLORS.ink, color: COLORS.paper, border: "none", fontSize: 13, letterSpacing: "0.04em", cursor: "pointer" }}
          >
            Continue shopping
          </button>
        </section>
      )}

      {/* LOGIN MODAL — one form for everyone. Typing "admin" as the email
          signs in as staff (unlocks the header's admin link); anything
          else signs in as an ordinary customer. This mirrors the real
          project's single /login page serving both roles. */}
      {loginOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(29,27,24,0.4)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setLoginOpen(false)}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: COLORS.paper, padding: 32, width: 320 }}>
            <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 22, marginBottom: 6, textAlign: "center" }}>Sign in</h2>
            <p style={{ fontSize: 11.5, color: COLORS.stoneDark, marginBottom: 18, textAlign: "center" }}>
              Demo — type "admin" to sign in as staff, anything else as a customer.
            </p>
            <input
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="Email"
              style={{ width: "100%", padding: "12px 14px", border: `1px solid ${COLORS.stone}`, background: COLORS.card, fontSize: 13.5, marginBottom: 12, boxSizing: "border-box" }}
            />
            <button
              onClick={() => {
                if (!loginEmail.trim()) return;
                setSession({ role: loginEmail.trim().toLowerCase().includes("admin") ? "STAFF" : "CUSTOMER" });
                setLoginOpen(false);
              }}
              style={{ width: "100%", padding: "13px 0", background: COLORS.ink, color: COLORS.paper, border: "none", fontSize: 13, letterSpacing: "0.04em", cursor: "pointer" }}
            >
              SIGN IN
            </button>
          </div>
        </div>
      )}

      {view === "admin" && !isStaff && (
        <section style={{ maxWidth: 360, margin: "0 auto", padding: "100px 28px", textAlign: "center" }}>
          <Lock size={22} style={{ marginBottom: 14 }} />
          <p style={{ fontSize: 13, color: COLORS.stoneDark }}>
            You need a staff account to view this page.
          </p>
        </section>
      )}

      {view === "admin" && isStaff && (
        <section style={{ padding: "36px 28px 72px", maxWidth: 1000, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
            <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 24, margin: 0 }}>Admin panel</h2>
            <div style={{ display: "flex", gap: 8 }}>
              {["products", "orders"].map((t) => (
                <button
                  key={t}
                  onClick={() => setAdminTab(t)}
                  style={{
                    padding: "8px 16px",
                    border: `1px solid ${COLORS.ink}`,
                    background: adminTab === t ? COLORS.ink : "transparent",
                    color: adminTab === t ? COLORS.paper : COLORS.ink,
                    fontSize: 12,
                    letterSpacing: "0.04em",
                    cursor: "pointer",
                  }}
                >
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {adminTab === "products" && (
            <>
              <button
                onClick={() =>
                  setEditingProduct({ id: "P" + Math.floor(Math.random() * 900 + 100), name: "", category: "Shirts", price: 0, stock: 0, swatch: "#545A3E", tag: "NEW" })
                }
                style={{ marginBottom: 20, padding: "10px 18px", background: COLORS.moss, color: COLORS.paper, border: "none", fontSize: 12.5, letterSpacing: "0.03em", cursor: "pointer" }}
              >
                + Add product
              </button>

              {editingProduct && (
                <div style={{ background: COLORS.card, border: `1px solid ${COLORS.stone}`, padding: 20, marginBottom: 24 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                    <input placeholder="Name" value={editingProduct.name} onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })} style={{ padding: 10, border: `1px solid ${COLORS.stone}`, fontSize: 13 }} />
                    <select value={editingProduct.category} onChange={(e) => setEditingProduct({ ...editingProduct, category: e.target.value })} style={{ padding: 10, border: `1px solid ${COLORS.stone}`, fontSize: 13 }}>
                      {CATEGORIES.filter((c) => c !== "All").map((c) => <option key={c}>{c}</option>)}
                    </select>
                    <input type="number" placeholder="Price" value={editingProduct.price} onChange={(e) => setEditingProduct({ ...editingProduct, price: Number(e.target.value) })} style={{ padding: 10, border: `1px solid ${COLORS.stone}`, fontSize: 13 }} />
                    <input type="number" placeholder="Stock" value={editingProduct.stock} onChange={(e) => setEditingProduct({ ...editingProduct, stock: Number(e.target.value) })} style={{ padding: 10, border: `1px solid ${COLORS.stone}`, fontSize: 13 }} />
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button onClick={() => saveProduct(editingProduct)} style={{ padding: "9px 18px", background: COLORS.ink, color: COLORS.paper, border: "none", fontSize: 12.5, cursor: "pointer" }}>Save</button>
                    <button onClick={() => setEditingProduct(null)} style={{ padding: "9px 18px", background: "transparent", border: `1px solid ${COLORS.stone}`, fontSize: 12.5, cursor: "pointer" }}>Cancel</button>
                  </div>
                </div>
              )}

              <div style={{ border: `1px solid ${COLORS.stone}` }}>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 80px", padding: "10px 14px", fontSize: 11, letterSpacing: "0.06em", color: COLORS.stoneDark, borderBottom: `1px solid ${COLORS.stone}` }}>
                  <span>PRODUCT</span><span>CATEGORY</span><span>PRICE</span><span>STOCK</span><span></span>
                </div>
                {products.map((p) => (
                  <div key={p.id} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 80px", padding: "12px 14px", fontSize: 13, alignItems: "center", borderBottom: `1px solid ${COLORS.stone}` }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ width: 24, height: 30, background: p.swatch, display: "inline-block" }} />
                      {p.name}
                    </span>
                    <span>{p.category}</span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{formatINR(p.price)}</span>
                    <span style={{ color: p.stock < 6 ? COLORS.clay : COLORS.ink }}>{p.stock}</span>
                    <span style={{ display: "flex", gap: 10 }}>
                      <button onClick={() => setEditingProduct(p)} style={{ background: "none", border: "none", cursor: "pointer" }}><Pencil size={14} /></button>
                      <button onClick={() => deleteProduct(p.id)} style={{ background: "none", border: "none", cursor: "pointer", color: COLORS.clay }}><Trash2 size={14} /></button>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {adminTab === "orders" && (
            <div style={{ border: `1px solid ${COLORS.stone}` }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.5fr 2fr 1fr 1fr 1fr", padding: "10px 14px", fontSize: 11, letterSpacing: "0.06em", color: COLORS.stoneDark, borderBottom: `1px solid ${COLORS.stone}` }}>
                <span>ORDER ID</span><span>CUSTOMER</span><span>ITEMS</span><span>TOTAL</span><span>STATUS</span>
              </div>
              {orders.map((o) => (
                <div key={o.id} style={{ display: "grid", gridTemplateColumns: "1.5fr 2fr 1fr 1fr 1fr", padding: "12px 14px", fontSize: 13, borderBottom: `1px solid ${COLORS.stone}` }}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{o.id}</span>
                  <span>{o.customer}</span>
                  <span>{o.items}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{formatINR(o.total)}</span>
                  <span style={{ color: o.status === "Paid" ? COLORS.moss : COLORS.clay }}>{o.status}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <footer style={{ padding: "28px", borderTop: `1px solid ${COLORS.stone}`, marginTop: 40, fontSize: 11.5, color: COLORS.stoneDark, textAlign: "center" }}>
        HABITT — demo prototype · mock data, resets on refresh
      </footer>
    </div>
  );
}
