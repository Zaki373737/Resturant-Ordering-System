/* =========================================================
   Brewed Awakening — Cart Logic (cart.js)
   localStorage-based cart state management
   ========================================================= */

const CART_KEY = 'ba_cart';
const CHECKOUT_KEY = 'ba_checkout';
const SELECTED_ITEM_KEY = 'ba_selected_item';

// ---- Core Cart Functions ----

function getCart() {
    try {
        return JSON.parse(localStorage.getItem(CART_KEY)) || [];
    } catch {
        return [];
    }
}

function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartBadge();
}

function addToCart(item) {
    const cart = getCart();
    const existing = cart.find(i => i.id === item.id);
    if (existing) {
        existing.quantity += (item.quantity || 1);
    } else {
        cart.push({
            id: item.id,
            name: item.name,
            price: parseFloat(item.price),
            image: item.image || '',
            description: item.description || '',
            tags: item.tags || [],
            quantity: item.quantity || 1
        });
    }
    saveCart(cart);
    showToast(`${item.name} added to cart`);
}

function updateQuantity(id, delta) {
    const cart = getCart();
    const item = cart.find(i => i.id === id);
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) {
        removeFromCart(id);
        return;
    }
    saveCart(cart);
}

function removeFromCart(id) {
    let cart = getCart();
    cart = cart.filter(i => i.id !== id);
    saveCart(cart);
}

function clearCart() {
    localStorage.removeItem(CART_KEY);
    updateCartBadge();
}

function getCartTotal() {
    const cart = getCart();
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const deliveryFee = cart.length > 0 ? 2.50 : 0;
    const tax = subtotal * 0.08;
    const total = subtotal + deliveryFee + tax;
    return {
        subtotal: Math.round(subtotal * 100) / 100,
        deliveryFee: Math.round(deliveryFee * 100) / 100,
        tax: Math.round(tax * 100) / 100,
        total: Math.round(total * 100) / 100
    };
}

function getCartItemCount() {
    const cart = getCart();
    return cart.reduce((sum, item) => sum + item.quantity, 0);
}

// ---- Checkout Data ----

function saveCheckoutData(data) {
    localStorage.setItem(CHECKOUT_KEY, JSON.stringify(data));
}

function getCheckoutData() {
    try {
        return JSON.parse(localStorage.getItem(CHECKOUT_KEY)) || {};
    } catch {
        return {};
    }
}

function clearCheckoutData() {
    localStorage.removeItem(CHECKOUT_KEY);
}

// ---- Selected Item (for item-detail page) ----

function setSelectedItem(item) {
    localStorage.setItem(SELECTED_ITEM_KEY, JSON.stringify(item));
}

function getSelectedItem() {
    try {
        return JSON.parse(localStorage.getItem(SELECTED_ITEM_KEY)) || null;
    } catch {
        return null;
    }
}

// ---- UI Helpers ----

function updateCartBadge() {
    const count = getCartItemCount();
    const badges = document.querySelectorAll('#cart-count');
    badges.forEach(badge => {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'flex' : 'none';
    });
}

function showToast(message) {
    // Remove existing toast if any
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.innerHTML = `<span class="material-symbols-outlined" style="font-size:18px;">check_circle</span> ${message}`;
    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 2500);
}

function formatPrice(price) {
    return 'PKR ' + price.toFixed(2);
}

// ---- Generate Unique ID from Item Name ----

function generateItemId(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// ---- Init: Update badge on every page load ----
document.addEventListener('DOMContentLoaded', () => {
    updateCartBadge();
});
