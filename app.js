// BACKEND CONFIGURATION (MULTI-TENANT): Mengambil URL dari local storage jika ada
let SCRIPT_URL = localStorage.getItem('tenant_script_url') || "";

// RESET OTOMATIS: Hapus memori jika yang tersimpan masih link dummy versi lama
if (SCRIPT_URL === "https://script.google.com/macros/s/AKfycbxBkcaqATf2TwWYPp9g1BotA3YfJqmPPdE1euJZmWXMSD9xdYZfeZols7T5H7jqVd7lBw/exec") {
    SCRIPT_URL = "";
    localStorage.removeItem('tenant_script_url');
}

// PENGATURAN TOKO (MULTI-TENANT)
let tenantName = localStorage.getItem('tenant_name') || "Forresa Laundry";
let tenantPhone = localStorage.getItem('tenant_phone') || "628123456789";

// STATE VARIABEL & DATABASE LOCAL MEMORY
let currentCashier = "";
let cart = []; // 🛒 Menyimpan daftar banyak layanan yang dipilih
let isNewCustomerMode = false;
let isLoading = true; // Status loading untuk efek shimmer

let services = [];
let customers = [];
let paymentMethods = ['Tunai / Cash', 'QRIS', 'Transfer Bank'];
let orders = [];
let expenses = []; 

// SESSION CONTROL LOGIC
window.addEventListener('DOMContentLoaded', () => {
    updateTenantUI();

    const urlParams = new URLSearchParams(window.location.search);
    const orderParam = urlParams.get('order');
    
    if (orderParam) {
        console.log("Aplikasi dibuka oleh pelanggan, bypass gerbang login admin.");
        return; 
    }

    const savedCashier = localStorage.getItem('active_cashier');
    if (savedCashier) {
        currentCashier = savedCashier;
        showMainApp();
    }
    
    const payDropdown = document.getElementById('cart-payment');
    if (payDropdown) {
        payDropdown.addEventListener('change', handlePaymentMethodChange);
    }
});

const CASHIER_ACCOUNTS = {
    "owner": "1234",
    "admin": "1234",
    "kasir1": "1234"
};

function submitLogin() {
    const nameInput = document.getElementById('input-cashier-name').value.trim();
    const pinInput = document.getElementById('input-input-pin') ? document.getElementById('input-input-pin').value : (document.getElementById('input-cashier-pin') ? document.getElementById('input-cashier-pin').value.trim() : "");
    
    if(!nameInput) return alert('Nama kasir wajib dimasukkan!');
    if(!pinInput) return alert('PIN keamanan wajib dimasukkan!');

    const correctPin = CASHIER_ACCOUNTS[nameInput];

    if (correctPin && pinInput === correctPin) {
        currentCashier = nameInput;
        localStorage.setItem('active_cashier', currentCashier);
        showMainApp();
        triggerNotification(`Selamat bertugas, ${currentCashier}! 👋`);
    } else {
        alert('❌ Kombinasi Nama Kasir atau PIN Rahasia Salah! Akses ditolak.');
    }
}

function showMainApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');
    document.getElementById('display-cashier').innerText = currentCashier;
    
    loadSettingsUI();
    setDefaultDates();
    
    setTimeout(function() {
        loadDataFromCloud();
    }, 500);
}

function logoutCashier() {
    localStorage.removeItem('active_cashier');
    location.reload();
}

function loadDataFromCloud() {
    if (SCRIPT_URL === "" || SCRIPT_URL.includes("TEMPEL_URL")) {
        isLoading = false;
        renderServicesGrid();
        populateDropdowns(); 
        renderOrders();
        calculateFinance();
        calculateExpenses();
        return;
    }
    
    console.log("Sedang menyelaraskan data dengan Google Sheets...");
    isLoading = true;
    renderServicesGrid();
    renderOrders();
    renderExpenses();

    fetch(`${SCRIPT_URL}?action=read`)
        .then(response => response.json())
        .then(cloudData => {
            if (!cloudData || cloudData.error) throw new Error("Data tidak valid");
            isLoading = false;

            if (cloudData.customServices && cloudData.customServices.length > 0) {
                services = cloudData.customServices.map(s => ({...s, icon: s.icon || 'fa-box-tissue'}));
            } else {
                services = [];
            }

            if (cloudData.transactions && cloudData.transactions.length > 0) {
                orders = cloudData.transactions.map(t => {
                    let parsedItems = [];
                    if (t.itemsDetail) {
                        try {
                            parsedItems = typeof t.itemsDetail === 'string' ? JSON.parse(t.itemsDetail) : t.itemsDetail;
                        } catch (e) {
                            parsedItems = [];
                        }
                    }

                    return {
                        id: t.id,
                        customer: t.customer,
                        phone: t.phone,
                        service: t.service,
                        total: Number(t.total),
                        cashier: t.cashier,
                        method: t.method,
                        status: t.status,
                        paymentStatus: t.paymentStatus ? t.paymentStatus : 'Lunas', 
                        cashPaid: t.cashPaid ? Number(t.cashPaid) : Number(t.total),
                        cashChange: t.cashChange ? Number(t.cashChange) : 0,
                        itemsDetail: parsedItems, 
                        date: t.date ? t.date : new Date().toISOString(),
                        estimatedPickup: t.estimatedPickup ? t.estimatedPickup : null 
                    };
                }).reverse(); 

                const uniqueCustomerNames = new Set();
                const tempCustomers = [];

                orders.forEach(order => {
                    if (order.customer && order.customer.trim() !== "") {
                        const normalName = order.customer.trim();
                        const lowerName = normalName.toLowerCase();
                        
                        if (!uniqueCustomerNames.has(lowerName)) {
                            uniqueCustomerNames.add(lowerName);
                            tempCustomers.push({
                                id: `C${tempCustomers.length + 1}`,
                                name: normalName,
                                phone: order.phone || '628123456789'
                            });
                        }
                    }
                });
                customers = tempCustomers;
            } else {
                orders = [];
                customers = [];
            }

            if (cloudData.expenses && cloudData.expenses.length > 0) {
                expenses = cloudData.expenses;
            } else {
                expenses = [];
            }

            renderServicesGrid();
            populateDropdowns(); 
            renderOrders();
            calculateFinance();
            calculateExpenses();
            console.log("Sinkronisasi database sukses!");
        })
        .catch(err => {
            console.error("Gagal sinkron data cloud:", err);
            isLoading = false;
            renderServicesGrid();
            populateDropdowns(); 
            renderOrders();
            calculateFinance();
            calculateExpenses();
        });
}


function switchView(viewId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    document.getElementById(`view-${viewId}`).classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('theme-color'));
    
    const clickedBtn = Array.from(document.querySelectorAll('.nav-btn')).find(btn => btn.getAttribute('onclick').includes(viewId));
    if(clickedBtn) clickedBtn.classList.add('theme-color');
}

function openNewServiceModal() {
    document.getElementById('serviceModal').classList.remove('hidden');
}

function saveNewService() {
    const name = document.getElementById('new-service-name').value.trim();
    const price = parseFloat(document.getElementById('new-service-price').value);
    const type = document.getElementById('new-service-type').value;

    if(!name || !price) return alert('Data input menu belum lengkap!');

    const newId = `S${services.length + 1}`;
    const newServicePayload = { id: newId, name, price, type, icon: 'fa-box-tissue' };
    
    services.push(newServicePayload);
    renderServicesGrid();
    document.getElementById('serviceModal').classList.add('hidden');
    
    if(SCRIPT_URL !== "" && !SCRIPT_URL.includes("SCRIPT_URL")) {
        const payloadToSend = {
            action: "addService",
            id: newServicePayload.id,
            name: newServicePayload.name,
            price: newServicePayload.price,
            type: newServicePayload.type
        };

        fetch(SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payloadToSend)
        }).catch(err => console.log(err));
    }
    
    document.getElementById('new-service-name').value = '';
    document.getElementById('new-service-price').value = '';
    triggerNotification(`Menu layanan "${name}" sukses ditambahkan!`);
}

function renderServicesGrid() {
    const grid = document.getElementById('services-grid');
    if(!grid) return;

    if (isLoading) {
        grid.innerHTML = `
            <div class="bg-slate-200 rounded-2xl h-36 animate-pulse"></div>
            <div class="bg-slate-200 rounded-2xl h-36 animate-pulse"></div>
            <div class="bg-slate-200 rounded-2xl h-36 animate-pulse"></div>
            <div class="bg-slate-200 rounded-2xl h-36 animate-pulse hidden sm:block"></div>
        `;
        return;
    }

    if (services.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center italic text-slate-400 py-8 bg-slate-50 rounded-2xl border border-slate-200 border-dashed">Data layanan/menu masih kosong. Tambahkan layanan baru.</div>`;
        return;
    }
    
    let htmlContent = '';
    services.forEach(item => {
        const isSelected = cart.some(cartItem => cartItem.id === item.id);
        const borderStyle = isSelected 
            ? 'border-cyan-400 bg-cyan-50/30 ring-2 ring-cyan-100' 
            : 'border-slate-100 hover:border-cyan-200 hover:shadow-sm';

        htmlContent += `
            <div onclick="selectServiceToCart('${item.id}')" class="bg-white p-5 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between h-36 relative active:scale-95 ${borderStyle}">
                <div class="absolute top-3 right-3 flex gap-2 z-20">
                    <button onclick="event.stopPropagation(); openEditServiceModal('${item.id}')" class="text-[10px] text-amber-500 bg-amber-50 w-6 h-6 rounded-full hover:bg-amber-100 flex items-center justify-center" title="Edit"><i class="fa-solid fa-pen"></i></button>
                    <button onclick="event.stopPropagation(); deleteServiceFromPOS('${item.id}')" class="text-[10px] text-rose-500 bg-rose-50 w-6 h-6 rounded-full hover:bg-rose-100 flex items-center justify-center" title="Hapus"><i class="fa-solid fa-trash"></i></button>
                </div>
                
                <div class="flex justify-between items-start">
                    <span class="text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-500 rounded-md">${item.type}</span>
                    <div class="w-2"></div>
                </div>
                <div>
                    <h4 class="font-bold text-slate-800 text-xs mb-0.5 line-clamp-1">${item.name}</h4>
                    <p class="text-sm font-bold theme-color">Rp ${item.price.toLocaleString('id-ID')}</p>
                </div>
            </div>`;
    });
    grid.innerHTML = htmlContent;
}

function openEditServiceModal(id) {
    const match = services.find(s => s.id === id);
    if (!match) return;

    document.getElementById('edit-service-id').value = match.id;
    document.getElementById('edit-service-name').value = match.name;
    document.getElementById('edit-service-price').value = match.price;
    document.getElementById('edit-service-type').value = match.type;

    document.getElementById('editServiceModal').classList.remove('hidden');
}

function closeEditServiceModal() {
    document.getElementById('editServiceModal').classList.add('hidden');
}

function submitEditService() {
    const id = document.getElementById('edit-service-id').value;
    const name = document.getElementById('edit-service-name').value.trim();
    const price = parseFloat(document.getElementById('edit-service-price').value);
    const type = document.getElementById('edit-service-type').value;

    if (!name || isNaN(price)) return alert('Data pengubahan belum lengkap!');

    const idx = services.findIndex(s => s.id === id);
    if (idx !== -1) {
        services[idx].name = name;
        services[idx].price = price;
        services[idx].type = type;
        renderServicesGrid();
        closeEditServiceModal();

        if (SCRIPT_URL !== "" && !SCRIPT_URL.includes("TEMPEL_URL")) {
            const editPayload = { action: "editService", id, name, price, type };
            fetch(SCRIPT_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(editPayload)
            }).catch(err => console.log(err));
        }
        triggerNotification(`Layanan "${name}" berhasil diperbarui!`);
    }
}

function deleteServiceFromPOS(id) {
    const match = services.find(s => s.id === id);
    if (!match) return;

    if (confirm(`Apakah Anda yakin ingin menghapus layanan "${match.name}"?`)) {
        services = services.filter(s => s.id !== id);
        renderServicesGrid();
        
        cart = cart.filter(c => c.id !== id);
        renderCart();

        if (SCRIPT_URL !== "" && !SCRIPT_URL.includes("TEMPEL_URL")) {
            const deletePayload = { action: "deleteService", id };
            fetch(SCRIPT_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(deletePayload)
            }).catch(err => console.log(err));
        }
        triggerNotification(`Layanan "${match.name}" telah dihapus.`);
    }
}

function populateDropdowns() {
    const custDropdown = document.getElementById('cart-customer');
    const payDropdown = document.getElementById('cart-payment');
    
    if(custDropdown) {
        if(customers.length > 0) {
            custDropdown.innerHTML = customers.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
        } else {
            custDropdown.innerHTML = `<option value="">Belum ada pelanggan terdaftar</option>`;
        }
    }
    if(payDropdown && paymentMethods) {
        payDropdown.innerHTML = paymentMethods.map(p => `<option value="${p}">${p}</option>`).join('');
    }
}

function selectServiceToCart(id) {
    const service = services.find(s => s.id === id);
    if (!service) return;

    if (!Array.isArray(cart)) cart = [];

    const existingItem = cart.find(item => item.id === id);
    if (existingItem) {
        existingItem.qty += 1;
    } else {
        cart.push({ 
            id: service.id, 
            name: service.name, 
            price: service.price, 
            type: service.type, 
            icon: service.icon, 
            qty: 1 
        });
    }

    renderCart();
    renderServicesGrid(); 
    triggerNotification(`Layanan ${service.name} masuk keranjang`);
}

function renderCart() {
    const container = document.getElementById('cart-items');
    if (!container) return;

    if (cart.length === 0) {
        container.innerHTML = `<span class="text-center italic text-slate-400 py-4 bg-slate-50 rounded-2xl border border-slate-100 border-dashed w-full block">Silahkan pilih produk di sebelah kiri...</span>`;
        const totalEl = document.getElementById('total-amount');
        if (totalEl) totalEl.innerText = "Rp 0";
        resetCashCalculationInputs();
        return;
    }

    let html = '<div class="space-y-3 w-full">';
    let totalAkhir = 0;

    cart.forEach((item, index) => {
        const subtotal = item.price * item.qty;
        totalAkhir += subtotal;
        const isKiloan = item.type === 'Kiloan';
        
        html += `
            <div class="bg-white border-2 border-teal-400 p-4 rounded-2xl shadow-xs w-full flex flex-col gap-3 relative">
                <div class="flex justify-between items-center w-full">
                    <p class="font-extrabold text-slate-800 text-sm tracking-tight pr-4 line-clamp-1 flex-1 text-left">
                        ${item.name}
                    </p>
                    <button type="button" onclick="deleteCartItem(${index})" class="text-rose-500 bg-rose-50 w-6 h-6 rounded-full hover:bg-rose-100 transition-all flex items-center justify-center shrink-0 shadow-2xs" title="Hapus Layanan">
                        <i class="fa-solid fa-trash text-[10px]"></i>
                    </button>
                </div>
                <div class="flex justify-between items-center w-full pt-2 border-t border-slate-50">
                    <div class="text-left">
                        <p class="text-[10px] text-slate-400 font-semibold">
                            Rp ${item.price.toLocaleString('id-ID')} / ${isKiloan ? 'Kg' : 'Pcs'}
                        </p>
                    </div>
                    <div class="flex items-center gap-1.5">
                        <span class="text-[10px] text-slate-400 font-bold">${isKiloan ? 'Berat:' : 'Jumlah:'}</span>
                        <input type="number" value="${item.qty}" min="0.01" step="${isKiloan ? '0.1' : '1'}" oninput="updateCartQty(${index}, this.value)" class="w-14 bg-slate-50 border border-slate-200 rounded-xl p-1 font-extrabold text-slate-700 text-center outline-none focus:border-[#40E0D0] transition-all text-xs">
                        <span class="text-[10px] text-slate-400 font-bold pr-1">${isKiloan ? 'Kg' : 'Pcs'}</span>
                        <span id="subtotal-${index}" class="font-extrabold text-slate-800 min-w-[70px] text-right text-sm">
                            Rp ${Math.round(subtotal).toLocaleString('id-ID')}
                        </span>
                    </div>
                </div>
            </div>`;
    });

    html += '</div>';
    container.innerHTML = html;
    
    const totalEl = document.getElementById('total-amount');
    if (totalEl) {
        totalEl.innerText = `Rp ${Math.round(totalAkhir).toLocaleString('id-ID')}`;
    }
    
    calculateChangeAutomatically();
}

function deleteCartItem(index) {
    const deletedItemName = cart[index].name;
    cart.splice(index, 1);
    renderCart();
    renderServicesGrid();
    triggerNotification(`Layanan "${deletedItemName}" dihapus dari keranjang`);
}

function updateCartQty(index, val) {
    let parsed = parseFloat(val);
    if (isNaN(parsed) || parsed < 0) parsed = 0;
    
    cart[index].qty = parsed; 
    
    const subtotalEl = document.getElementById(`subtotal-${index}`);
    if (subtotalEl) {
        subtotalEl.innerText = `Rp ${Math.round(cart[index].price * cart[index].qty).toLocaleString('id-ID')}`;
    }
    
    let totalAkhir = 0;
    cart.forEach((item) => {
        totalAkhir += (item.price * item.qty);
    });
    
    const totalAmountEl = document.getElementById('total-amount');
    if (totalAmountEl) {
        totalAmountEl.innerText = `Rp ${Math.round(totalAkhir).toLocaleString('id-ID')}`;
    }
    
    calculateChangeAutomatically();
}

function handlePaymentMethodChange() {
    const payDropdown = document.getElementById('cart-payment');
    if (!payDropdown) return;
    
    const payMethod = payDropdown.value;
    const cashWrapper = document.getElementById('wrapper-cash-calculation');
    const inputPaidEl = document.getElementById('cart-cash-paid');
    
    const safeCart = Array.isArray(cart) ? cart : [];
    const totalHargaAkhir = safeCart.reduce((sum, item) => sum + (item.price * item.qty), 0);

    if (!cashWrapper) return;
    
    if (payMethod === 'Tunai / Cash') {
        cashWrapper.classList.remove('hidden');
        if (inputPaidEl) inputPaidEl.value = ''; 
        calculateChangeAutomatically();
    } else {
        cashWrapper.classList.add('hidden');
        if (inputPaidEl) inputPaidEl.value = totalHargaAkhir; 
        const displayChangeEl = document.getElementById('cart-cash-change');
        if (displayChangeEl) displayChangeEl.innerText = "Rp 0";
    }
}

function calculateChangeAutomatically() {
    const totalHargaAkhir = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const inputPaidEl = document.getElementById('cart-cash-paid');
    const displayChangeEl = document.getElementById('cart-cash-change');
    
    if (!inputPaidEl || !displayChangeEl) return;
    
    const payMethod = document.getElementById('cart-payment') ? document.getElementById('cart-payment').value : 'Tunai / Cash';
    
    if (payMethod !== 'Tunai / Cash') {
        inputPaidEl.value = totalHargaAkhir;
        displayChangeEl.innerText = "Rp 0";
        displayChangeEl.className = "w-full text-xs bg-slate-100 border border-slate-200 rounded-xl p-3 font-bold text-slate-600";
        return;
    }

    const cashPaidValue = parseFloat(inputPaidEl.value) || 0;
    
    if (cashPaidValue === 0 || cashPaidValue < totalHargaAkhir) {
        displayChangeEl.innerText = "Rp 0";
        displayChangeEl.className = "w-full text-xs bg-slate-100 border border-slate-200 rounded-xl p-3 font-bold text-rose-500";
    } else {
        const changeResult = cashPaidValue - totalHargaAkhir;
        displayChangeEl.innerText = `Rp ${changeResult.toLocaleString('id-ID')}`;
        displayChangeEl.className = "w-full text-xs bg-emerald-50 border border-emerald-100 rounded-xl p-3 font-bold text-emerald-600";
    }
}

function resetCashCalculationInputs() {
    const inputPaidEl = document.getElementById('cart-cash-paid');
    const displayChangeEl = document.getElementById('cart-cash-change');
    if(inputPaidEl) inputPaidEl.value = '';
    if(displayChangeEl) {
        displayChangeEl.innerText = 'Rp 0';
        displayChangeEl.className = "w-full text-xs bg-slate-100 border border-slate-200 rounded-xl p-3 font-bold text-slate-600";
    }
}

function toggleNewCustomerInput() {
    const toggleInput = document.getElementById('customer-toggle-input');
    const boxOld = document.getElementById('box-old-customer');
    const boxNew = document.getElementById('box-new-customer');
    
    if (!toggleInput || !boxOld || !boxNew) return;

    isNewCustomerMode = toggleInput.checked;

    if (isNewCustomerMode) {
        boxOld.classList.add('hidden');
        boxNew.classList.remove('hidden');
    } else {
        boxOld.classList.remove('hidden');
        boxNew.classList.add('hidden');
        document.getElementById('new-cust-name').value = '';
        document.getElementById('new-cust-phone').value = '';
    }
}

function processCheckout() {
    if (cart.length === 0) return triggerNotification('Pilih layanan laundry terlebih dahulu!');
    
    cart = cart.filter(item => item.qty > 0);
    if (cart.length === 0) return alert('❌ Jumlah berat atau pcs layanan tidak boleh kosong atau 0!');
    
    const payMethod = document.getElementById('cart-payment').value;
    const totalHargaAkhir = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    
    let cashPaid = 0;
    let cashChange = 0;
    
    if (payMethod === 'Tunai / Cash') {
        const inputPaidEl = document.getElementById('cart-cash-paid');
        cashPaid = parseFloat(inputPaidEl ? inputPaidEl.value : 0) || 0;
        
        let selectedPaymentStatus = "Lunas";
        const statusDropdown = document.getElementById('cart-payment-status');
        if (statusDropdown) selectedPaymentStatus = statusDropdown.value;

        if (selectedPaymentStatus === "Lunas" && cashPaid < totalHargaAkhir) {
            return alert(`❌ Uang yang dibayar (Rp ${cashPaid.toLocaleString('id-ID')}) kurang dari nominal tagihan total belanja!`);
        }
        if (cashPaid >= totalHargaAkhir) {
            cashChange = cashPaid - totalHargaAkhir;
        }
    } else {
        cashPaid = totalHargaAkhir;
        cashChange = 0;
    }

    const generatedOrderId = `FRS-${Math.floor(1000 + Math.random() * 9000)}`;
    
    let customerName = "";
    let customerPhone = "";

    if (isNewCustomerMode || customers.length === 0) {
        const inputName = document.getElementById('new-cust-name').value.trim();
        const inputPhone = document.getElementById('new-cust-phone').value.trim();

        if (!inputName) return alert('Nama pelanggan baru wajib diisi!');
        
        customerName = inputName;
        customerPhone = inputPhone ? (inputPhone.startsWith('0') ? '62' + inputPhone.slice(1) : inputPhone) : "-";

        customers.push({ id: `C${customers.length + 1}`, name: customerName, phone: customerPhone });
        populateDropdowns();
    } else {
        customerName = document.getElementById('cart-customer').value;
        const targetCust = customers.find(c => c.name === customerName);
        customerPhone = targetCust && targetCust.phone ? targetCust.phone : "-";
    }

    const serviceDetailLabel = cart.map(item => `${item.name} (${item.qty}x)`).join(", ");
    
    let selectedPaymentStatus = "Lunas";
    const statusDropdown = document.getElementById('cart-payment-status');
    if (statusDropdown) {
        selectedPaymentStatus = statusDropdown.value;
    }

    const itemsDetailBackup = cart.map(c => ({ name: c.name, price: c.price, qty: c.qty }));
    const inputOrderDate = document.getElementById('cart-order-date').value;
    const inputPickupDate = document.getElementById('cart-pickup-date').value;

    if (!inputOrderDate || !inputPickupDate) {
        return alert('❌ Tanggal masuk (nota) dan estimasi pengambilan wajib diisi!');
    }

    const checkoutPayload = {
        id: generatedOrderId,
        customer: customerName,
        phone: customerPhone,
        service: serviceDetailLabel, 
        total: totalHargaAkhir,
        cashier: currentCashier || "Kasir",
        method: payMethod,
        status: 'Diproses',
        paymentStatus: selectedPaymentStatus, 
        cashPaid: cashPaid,
        cashChange: cashChange,
        itemsDetail: itemsDetailBackup,
        date: inputOrderDate,               
        estimatedPickup: inputPickupDate    
    };

    // Tambah ke riwayat lokal layar kasir
    orders.unshift(checkoutPayload);
    renderOrders();
    calculateFinance();
    openReceiptModal(checkoutPayload);

    // Sync ke Cloud Google Sheets jika URL valid
    if (SCRIPT_URL !== "" && !SCRIPT_URL.includes("SCRIPT_URL")) {
        const cloudPayload = {
            action: "checkout", // FIX BUG 2: Berikan identitas aksi agar Google Apps Script mengenalnya
            ...checkoutPayload,
            itemsDetail: JSON.stringify(itemsDetailBackup)
        };
        
        fetch(SCRIPT_URL, { 
            method: 'POST', 
            mode: 'no-cors', 
            headers: {'Content-Type': 'application/json'}, 
            body: JSON.stringify(cloudPayload) 
        })
        .then(() => console.log("Data berhasil dikirim ke Google Sheets."))
        .catch(err => console.log("Gagal sinkronisasi cloud:", err));
    }
    
    cart = [];
    renderCart();
    
    const toggleInput = document.getElementById('customer-toggle-input');
    if (toggleInput && toggleInput.checked) {
        toggleInput.checked = false;
    }
    toggleNewCustomerInput(); 
    
    document.getElementById('new-cust-name').value = '';
    document.getElementById('new-cust-phone').value = '';
    resetCashCalculationInputs();
    renderServicesGrid();
    setDefaultDates();
    
    triggerNotification(`Nota ${generatedOrderId} berhasil diproses!`);
}
function openReceiptModal(order) {
    if(document.getElementById('nota-date')) document.getElementById('nota-date').innerText = formatTanggalIndo(order.date);
    if(document.getElementById('nota-date-in')) document.getElementById('nota-date-in').innerText = formatTanggalIndo(order.date);
    if(document.getElementById('nota-estimasi')) document.getElementById('nota-estimasi').innerText = order.estimatedPickup ? formatTanggalIndo(order.estimatedPickup) : "-";

    document.getElementById('nota-id').innerText = order.id;
    document.getElementById('nota-cashier').innerText = order.cashier;
    document.getElementById('nota-customer').innerText = order.customer;
    
    const notaItemsContainer = document.getElementById('nota-items-list');
    if (notaItemsContainer) {
        if (order.itemsDetail && order.itemsDetail.length > 0) {
            notaItemsContainer.innerHTML = order.itemsDetail.map(item => `
                <div class="flex justify-between items-start py-0.5 border-b border-slate-50">
                    <div class="max-w-[180px]">
                        <p class="font-semibold">${item.name}</p>
                        <p class="text-[10px] text-slate-400">${item.qty}x @ Rp ${item.price.toLocaleString('id-ID')}</p>
                    </div>
                    <span class="font-bold text-slate-700">Rp ${(item.price * item.qty).toLocaleString('id-ID')}</span>
                </div>
            `).join('');
        } else {
            notaItemsContainer.innerHTML = `
                <div class="flex justify-between">
                    <span class="font-semibold">${order.service}</span>
                </div>`;
        }
    }
    
    if(document.getElementById('nota-service')) document.getElementById('nota-service').innerText = order.service;
    if(document.getElementById('nota-price')) document.getElementById('nota-price').innerText = `Rp ${order.total.toLocaleString('id-ID')}`;

    const elementPay = document.getElementById('nota-paymethod') || document.getElementById('nota-payMethod');
    if (elementPay) elementPay.innerText = order.method || "Tunai / Cash";

    if(document.getElementById('nota-payment-status')) document.getElementById('nota-payment-status').innerText = order.paymentStatus || 'Lunas';

    document.getElementById('nota-total').innerText = `Rp ${order.total.toLocaleString('id-ID')}`;
    
    const displayPaidReceipt = document.getElementById('nota-cash-paid-display');
    const displayChangeReceipt = document.getElementById('nota-cash-change-display');
    
    if(displayPaidReceipt) displayPaidReceipt.innerText = order.cashPaid ? `Rp ${order.cashPaid.toLocaleString('id-ID')}` : 'Rp 0';
    if(displayChangeReceipt) displayChangeReceipt.innerText = order.cashChange ? `Rp ${order.cashChange.toLocaleString('id-ID')}` : 'Rp 0';
    
    document.getElementById('track-id').innerText = order.id;
    document.getElementById('track-cust').innerText = order.customer;
    document.getElementById('track-service').innerText = order.service;
    document.getElementById('track-total').innerText = `Rp ${order.total.toLocaleString('id-ID')}`;
    document.getElementById('track-badge').innerText = order.status.toUpperCase();

    const generatedTrackingUrl = `https://kasir-laundry-demo.page.gd?order=${order.id}`;
    
    document.getElementById("qrcode").innerHTML = "";
    const qrcodeSvg = new QRCode({
        content: generatedTrackingUrl,
        padding: 0,
        width: 80,
        height: 80,
        color: "#000000",
        background: "#ffffff",
        ecl: "L"
    }).svg();
    
    document.getElementById("qrcode").innerHTML = qrcodeSvg;
    document.getElementById('receiptModal').classList.remove('hidden');
}

function openReceiptModalById(id) {
    const match = orders.find(o => o.id === id);
    if(match) openReceiptModal(match);
}

function sendWhatsAppReceipt() {
    const id = document.getElementById('nota-id').innerText;
    const customer = document.getElementById('nota-customer').innerText;
    const total = document.getElementById('nota-total').innerText;
    
    let customerPhone = "";
    const currentOrderData = orders.find(o => o.id === id);
    
    if (currentOrderData && currentOrderData.phone) {
        customerPhone = currentOrderData.phone.trim().replace(/[-+ _]/g, "");
        if (customerPhone.startsWith("0")) {
            customerPhone = "62" + customerPhone.slice(1);
        }
    }
    
    const trackingUrl = `https://kasir-laundry-demo.page.gd?order=${id}`;
    const messageText = `Halo, Terima kasih telah mencuci di *${tenantName}*.\n\nBerikut rincian Nota Transaksi digital Anda:\n🆔 No Nota: *${id}*\n👤 Konsumen: *${customer}*\n💰 Total Bill: *${total}*\n\n🌿 Pantau status proses pengerjaan laundry pakaian Anda secara realtime melalui link tautan resmi di bawah ini:\n🔗 ${trackingUrl}`;
    
    if (customerPhone !== "" && customerPhone !== "-") {
        window.open(`https://api.whatsapp.com/send?phone=${customerPhone}&text=${encodeURIComponent(messageText)}`, '_blank');
    } else {
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(messageText)}`, '_blank');
    }
}

function searchByQR(val) {
    let q = val.toUpperCase();
    document.querySelectorAll('#orders-list > div').forEach(c => {
        c.innerText.toUpperCase().includes(q) ? c.classList.remove('hidden') : c.classList.add('hidden');
    });
}

function renderOrders() {
    const ordersList = document.getElementById('orders-list');
    if(!ordersList) return;

    if (isLoading) {
        ordersList.innerHTML = `
            <div class="bg-slate-200 rounded-2xl h-36 animate-pulse"></div>
            <div class="bg-slate-200 rounded-2xl h-36 animate-pulse"></div>
            <div class="bg-slate-200 rounded-2xl h-36 animate-pulse"></div>
        `;
        return;
    }

    if (orders.length === 0) {
        ordersList.innerHTML = `<div class="col-span-full text-center italic text-slate-400 py-8 bg-slate-50 rounded-2xl border border-slate-200 border-dashed">Data transaksi masih kosong. Belum ada riwayat nota masuk.</div>`;
        return;
    }
    
    ordersList.innerHTML = orders.map(o => {
        let badgeColor = "bg-amber-50 text-amber-600";
        if (o.status === 'Selesai') badgeColor = "bg-cyan-50 text-cyan-600";
        if (o.status === 'Diambil') badgeColor = "bg-green-50 text-green-600";

        const isBelumBayar = o.paymentStatus === 'Belum Bayar';
        const paymentBoxClass = isBelumBayar 
            ? 'bg-rose-50 border border-rose-200 text-rose-600 font-bold px-2.5 py-1 rounded-xl text-[11px] inline-flex items-center gap-1 mt-1.5'
            : 'bg-emerald-50 border border-emerald-200 text-emerald-600 font-bold px-2.5 py-1 rounded-xl text-[11px] inline-flex items-center gap-1 mt-1.5';

        return `
            <div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs space-y-3">
                <div class="flex justify-between items-center">
                    <span class="text-xs font-mono font-bold text-slate-400">${o.id}</span>
                    <span class="text-[10px] px-2.5 py-0.5 font-bold rounded-full ${badgeColor}">${o.status.toUpperCase()}</span>
                </div>
                <div>
                    <h4 class="font-bold text-slate-800 text-sm">${o.customer}</h4>
                    <p class="text-[11px] text-slate-400">${o.service}</p>
                    <p class="text-[10px] text-slate-400 italic">WA: +${o.phone}</p>
                    
                    <div class="${paymentBoxClass}">
                        <i class="${isBelumBayar ? 'fa-solid fa-circle-exclamation' : 'fa-solid fa-circle-check'}"></i> 
                        ${o.paymentStatus || 'Lunas'}
                    </div>
                </div>
                <div class="space-y-2 pt-2 border-t border-slate-50">
                    <label class="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Update Status Operasional:</label>
                    <select onchange="updateOrderStatus('${o.id}', this.value)" class="w-full text-[11px] bg-slate-50 border border-slate-200 rounded-lg p-1.5 font-semibold text-slate-700 outline-none focus:border-cyan-400">
                        <option value="Diproses" ${o.status === 'Diproses' ? 'selected' : ''}>⏳ Sedang Diproses</option>
                        <option value="Selesai" ${o.status === 'Selesai' ? 'selected' : ''}>✨ Selesai (Siap Ambil)</option>
                        <option value="Diambil" ${o.status === 'Diambil' ? 'selected' : ''}>✅ Sudah Diambil Pelanggan</option>
                    </select>
                    <select onchange="updatePaymentStatus('${o.id}', this.value)" class="w-full text-[11px] bg-slate-50 border border-slate-200 rounded-lg p-1.5 font-semibold text-slate-700 outline-none focus:border-cyan-400 mt-1.5">
                        <option value="Lunas" ${o.paymentStatus === 'Lunas' ? 'selected' : ''}>✔️ Lunas</option>
                        <option value="Belum Bayar" ${o.paymentStatus === 'Belum Bayar' ? 'selected' : ''}>🔴 Belum Bayar</option>
                    </select>
                </div>
                <div class="flex justify-between items-center pt-2">
                    <span class="text-xs font-bold theme-color">Rp ${o.total.toLocaleString('id-ID')}</span>
                    <div class="flex gap-1">
                        <button onclick="openLiveTrackingPreview('${o.id}')" class="text-[10px] font-bold bg-cyan-50 text-[#40E0D0] px-2.5 py-1.5 rounded-lg hover:bg-cyan-100/50" title="Cek Tampilan Live"><i class="fa-solid fa-eye"></i></button>
                        <button onclick="openReceiptModalById('${o.id}')" class="text-[10px] font-bold bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg hover:bg-slate-200">Buka Struk</button>
                    </div>
                </div>
            </div>`;
    }).join('');
}

function updateOrderStatus(orderId, newStatus) {
    const orderIndex = orders.findIndex(o => o.id === orderId);
    if (orderIndex !== -1) {
        orders[orderIndex].status = newStatus;
        renderOrders();
        
        if (SCRIPT_URL !== "" && !SCRIPT_URL.includes("SCRIPT_URL")) {
            fetch(SCRIPT_URL, { 
                method: 'POST', 
                mode: 'no-cors', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify({ 
                    action: "updateStatus", 
                    id: orderId, 
                    status: newStatus 
                }) 
            })
            .then(() => console.log(`Berhasil sinkron status ${orderId} ke cloud.`))
            .catch(err => console.log("Gagal sinkron cloud:", err));
        }
        triggerNotification(`Status pesanan nota ${orderId} diubah menjadi: ${newStatus}`);
    }
}

function openLiveTrackingPreview(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    document.getElementById('track-id').innerText = order.id;
    document.getElementById('track-cust').innerText = order.customer;
    document.getElementById('track-service').innerText = order.service;
    document.getElementById('track-total').innerText = `Rp ${order.total.toLocaleString('id-ID')}`;
    document.getElementById('track-badge').innerText = order.status.toUpperCase();

    if(document.getElementById('track-date-in')) document.getElementById('track-date-in').innerText = formatTanggalIndo(order.date);
    if(document.getElementById('track-date-out')) document.getElementById('track-date-out').innerText = order.estimatedPickup ? formatTanggalIndo(order.estimatedPickup) : "-";

    const trackPaymentEl = document.getElementById('track-payment-status');
    if (trackPaymentEl) {
        const isBelumBayar = order.paymentStatus === 'Belum Bayar';
        trackPaymentEl.innerText = isBelumBayar ? '🔴 Belum Bayar' : '🟢 Lunas';
        trackPaymentEl.className = isBelumBayar
            ? 'inline-flex items-center gap-1 font-bold px-2.5 py-1 rounded-xl text-[11px] bg-rose-50 border border-rose-200 text-rose-600 mt-0.5'
            : 'inline-flex items-center gap-1 font-bold px-2.5 py-1 rounded-xl text-[11px] bg-emerald-50 border border-emerald-200 text-emerald-600 mt-0.5';
    }

    const steps = document.querySelectorAll('#view-tracking .relative.pl-6 > div');
    
    steps.forEach((step) => {
        setStepActive(step, false, false);
    });

    if (order.status === "Diproses") {
        setStepActive(steps[0], true, false); 
        setStepActive(steps[1], true, true);  
    } else if (order.status === "Selesai") {
        setStepActive(steps[0], true, false); 
        setStepActive(steps[1], true, false); 
        setStepActive(steps[2], true, true);  
    } else if (order.status === "Diambil") {
        setStepActive(steps[0], true, false); 
        setStepActive(steps[1], true, false); 
        setStepActive(steps[2], true, false); 
        setStepActive(steps[3], true, false); 
    }

    switchView('tracking');
}

function setStepActive(stepElement, isActive, isPulse) {
    if(!stepElement) return;
    const dot = stepElement.querySelector('span:not(.animate-ping)');
    const ping = stepElement.querySelector('.animate-ping');
    const title = stepElement.querySelector('p:nth-of-type(1)');

    if(isActive) {
        if(dot) dot.className = "absolute -left-[31px] top-1 w-4 h-4 rounded-full theme-bg border-2 border-white shadow-sm z-10";
        if(title) title.className = "text-xs font-bold text-slate-700";
    } else {
        if(dot) dot.className = "absolute -left-[31px] top-1 w-4 h-4 rounded-full bg-slate-200 border-2 border-white z-10";
        if(title) title.className = "text-xs font-semibold text-slate-400";
    }

    if (ping) {
        if (isPulse) {
            ping.className = "absolute -left-[31px] top-1 w-4 h-4 rounded-full theme-bg opacity-75 animate-ping";
        } else {
            ping.classList.add('hidden');
        }
    }
}

function toggleFinanceFilterInputs() {
    const mode = document.getElementById('finance-filter-mode').value;
    const wrapDate = document.getElementById('wrapper-filter-date');
    const wrapMonth = document.getElementById('wrapper-filter-month');

    wrapDate.classList.add('hidden');
    wrapMonth.classList.add('hidden');

    const now = new Date();
    const jktTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Jakarta"}));

    if (mode === 'date') {
        wrapDate.classList.remove('hidden');
        if(!document.getElementById('finance-input-date').value) {
            document.getElementById('finance-input-date').value = jktTime.toISOString().split('T')[0];
        }
    } else if (mode === 'month') {
        wrapMonth.classList.remove('hidden');
        if(!document.getElementById('finance-input-month').value) {
            const year = jktTime.getFullYear();
            const month = String(jktTime.getMonth() + 1).padStart(2, '0');
            document.getElementById('finance-input-month').value = `${year}-${month}`;
        }
    }
    calculateFinance();
}

function calculateFinance() {
    const mode = document.getElementById('finance-filter-mode') ? document.getElementById('finance-filter-mode').value : 'all';
    const logList = document.getElementById('finance-log-list');
    
    let filteredOrders = [...orders];
    let labelInfo = "Semua transaksi terpantau";

    const now = new Date();
    const jktTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Jakarta"}));
    const todayStr = jktTime.toISOString().split('T')[0]; 

    if (mode === 'today') {
        filteredOrders = orders.filter(o => {
            if (!o.date) return false;
            const orderDateStr = new Date(o.date).toISOString().split('T')[0];
            return orderDateStr === todayStr;
        });
        labelInfo = `Rekapitulasi omzet Hari Ini`;
    } else if (mode === 'date') {
        const pickerDate = document.getElementById('finance-input-date').value;
        if (pickerDate) {
            filteredOrders = orders.filter(o => {
                if (!o.date) return false;
                const orderDateStr = new Date(o.date).toISOString().split('T')[0];
                return orderDateStr === pickerDate;
            });
            const d = new Date(pickerDate);
            labelInfo = `Tanggal: ${d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`;
        }
    } else if (mode === 'month') {
        const pickerMonth = document.getElementById('finance-input-month').value;
        if (pickerMonth) {
            filteredOrders = orders.filter(o => {
                if (!o.date) return false;
                const orderDateObj = new Date(o.date);
                const orderYear = orderDateObj.getFullYear();
                const orderMonth = String(orderDateObj.getMonth() + 1).padStart(2, '0');
                return `${orderYear}-${orderMonth}` === pickerMonth;
            });
            const [year, month] = pickerMonth.split('-');
            const d = new Date(year, month - 1);
            labelInfo = `Bulan: ${d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}`;
        }
    }

    const totalIncome = filteredOrders.reduce((sum, o) => sum + o.total, 0);
    const totalNotes = filteredOrders.length;

    const totalCash = filteredOrders
        .filter(o => o.method && (o.method.toLowerCase().includes('tunai') || o.method.toLowerCase().includes('cash')))
        .reduce((sum, o) => sum + o.total, 0);

    const totalQris = filteredOrders
        .filter(o => o.method && o.method.toLowerCase().includes('qris'))
        .reduce((sum, o) => sum + o.total, 0);

    const totalBank = filteredOrders
        .filter(o => o.method && (o.method.toLowerCase().includes('transfer') || o.method.toLowerCase().includes('debit') || o.method.toLowerCase().includes('bank')))
        .reduce((sum, o) => sum + o.total, 0);

    if(document.getElementById('rep-income')) document.getElementById('rep-income').innerText = `Rp ${totalIncome.toLocaleString('id-ID')}`;
    if(document.getElementById('rep-orders-count')) document.getElementById('rep-orders-count').innerText = `${totalNotes} Nota`;
    if(document.getElementById('finance-summary-label')) document.getElementById('finance-summary-label').innerText = labelInfo;

    if(document.getElementById('rep-income-cash')) document.getElementById('rep-income-cash').innerText = `Rp ${totalCash.toLocaleString('id-ID')}`;
    if(document.getElementById('rep-income-qris')) document.getElementById('rep-income-qris').innerText = `Rp ${totalQris.toLocaleString('id-ID')}`;
    if(document.getElementById('rep-income-bank')) document.getElementById('rep-income-bank').innerText = `Rp ${totalBank.toLocaleString('id-ID')}`;

    if (logList) {
        if (isLoading) {
            logList.innerHTML = `
                <div class="bg-slate-200 rounded-xl h-12 mb-2 animate-pulse"></div>
                <div class="bg-slate-200 rounded-xl h-12 mb-2 animate-pulse"></div>
                <div class="bg-slate-200 rounded-xl h-12 animate-pulse"></div>
            `;
            return;
        }

        if(filteredOrders.length === 0) {
            logList.innerHTML = `<p class="text-center italic text-slate-400 py-4 border border-dashed border-slate-200 rounded-xl mt-2">Data log masih kosong. Tidak ada riwayat transaksi.</p>`;
            return;
        }

        logList.innerHTML = filteredOrders.map(o => `
            <div class="flex justify-between items-center p-2.5 bg-slate-50 rounded-xl border border-slate-100 mb-2">
                <div class="space-y-0.5">
                    <p class="font-bold text-slate-700 text-xs">${o.customer} <span class="font-mono text-[10px] text-slate-400 font-normal">(${o.id})</span></p>
                    <p class="text-[10px] text-slate-400 line-clamp-1">${o.service}</p>
                </div>
                <div class="text-right">
                    <p class="font-bold text-emerald-600 text-xs">+Rp ${o.total.toLocaleString('id-ID')}</p>
                    <p class="text-[9px] text-slate-400 uppercase font-medium">${o.method ? o.method.split(' ')[0] : 'KAS'}</p>
                </div>
            </div>`).join('');
    }
}

function exportToExcel() {
    if(orders.length === 0) return alert('Data transaksi masih kosong!');
    const ws = XLSX.utils.json_to_sheet(orders);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rekap Penjualan");
    XLSX.writeFile(wb, "Forresa_Laundry_Report.xlsx");
}

function triggerNotification(msg) {
    const banner = document.getElementById('liveAlert');
    if(!banner) return;
    document.getElementById('alertMessage').innerText = msg;
    banner.classList.remove('hidden');
    setTimeout(() => banner.classList.add('hidden'), 5000);
}

window.addEventListener('load', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const orderParam = urlParams.get('order');
    
    if (orderParam) {
        console.log("Mendeteksi Pelanggan melakukan pelacakan nota:", orderParam);
        
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('main-app').classList.remove('hidden');
        
        const headerKasir = document.querySelector('header');
        if(headerKasir) headerKasir.style.display = 'none';
        
        const navBawah = document.querySelector('nav');
        if(navBawah) navBawah.style.display = 'none';
        
        const mainAppEl = document.getElementById('main-app');
        if(mainAppEl) mainAppEl.className = 'min-h-screen flex flex-col pb-0';

        document.getElementById('track-id').innerText = "MENCARI DATA...";
        document.getElementById('track-cust').innerText = "Sedang mengunduh data dari server...";
        switchView('tracking');

        function fetchStatusPelanggan() {
            if (SCRIPT_URL === "" || SCRIPT_URL.includes("SCRIPT_URL")) return;
            console.log("Menyelaraskan status nota konsumen secara real-time...");
            
            fetch(`${SCRIPT_URL}?order=${encodeURIComponent(orderParam)}`)
                .then(response => response.json())
                .then(cloudData => {
                    if (cloudData && cloudData.transactions && cloudData.transactions.length > 0) {
                        const match = cloudData.transactions[0];
                        openLiveTrackingPreview(match.id);
                        
                        const orderIdx = orders.findIndex(o => o.id.toUpperCase() === match.id.toUpperCase());
                        if(orderIdx !== -1) orders[orderIdx] = match; else orders.unshift(match);
                    } else {
                        document.getElementById('track-id').innerText = "TIDAK DITEMUKAN";
                        document.getElementById('track-cust').innerText = "Maaf, nomor nota tersebut tidak terdaftar.";
                    }
                })
                .catch(err => console.log("Gagal auto-update status:", err));
        }

        fetchStatusPelanggan();
        setInterval(fetchStatusPelanggan, 10000); 
    }
});

const PRINTER_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb';
const PRINTER_CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb';

async function printBluetoothReceipt() {
    try {
        const notaId = document.getElementById('nota-id').innerText;
        const currentOrderData = orders.find(o => o.id === notaId);
        if (!currentOrderData) {
            return alert('❌ Data transaksi tidak ditemukan di memori sistem!');
        }

        const notaCashier = currentOrderData.cashier || "Kasir";
        const notaCustomer = currentOrderData.customer || "-";
        const notaTotal = currentOrderData.total || 0;
        const notaPaymethod = currentOrderData.method || "Tunai / Cash"; 
        const notaPaymentStatus = currentOrderData.paymentStatus || "Lunas";

        let paidVal = currentOrderData.cashPaid !== undefined && currentOrderData.cashPaid !== null ? currentOrderData.cashPaid : currentOrderData.total;
        let changeVal = currentOrderData.cashChange !== undefined && currentOrderData.cashChange !== null ? currentOrderData.cashChange : 0;

        const trackingUrl = `https://kasir-laundry-demo.page.gd?order=${notaId}`;

        const device = await navigator.bluetooth.requestDevice({
            filters: [
                { namePrefix: 'MTP' }, { namePrefix: 'RPP' }, { namePrefix: 'POS' }, { namePrefix: 'EPPOS' },
                { services: [PRINTER_SERVICE_UUID] }
            ],
            optionalServices: [PRINTER_SERVICE_UUID]
        });

        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(PRINTER_SERVICE_UUID);
        const characteristic = await service.getCharacteristic(PRINTER_CHARACTERISTIC_UUID);

        const encoder = new TextEncoder();
        const ESC = 0x1B; const GS = 0x1D;

        const CMD_INIT = new Uint8Array([ESC, 0x40]);
        const CMD_CENTER = new Uint8Array([ESC, 0x61, 1]);
        const CMD_LEFT = new Uint8Array([ESC, 0x61, 0]);
        const CMD_RIGHT = new Uint8Array([ESC, 0x61, 2]);
        const CMD_BOLD_ON = new Uint8Array([ESC, 0x45, 1]);
        const CMD_BOLD_OFF = new Uint8Array([ESC, 0x45, 0]);
        const CMD_FEED = new Uint8Array([ESC, 0x64, 4]);

        const text = (str) => encoder.encode(str + "\n");

        const qrData = encoder.encode(trackingUrl);
        const qrLength = qrData.length + 3;
        const pL = qrLength & 0xFF;
        const pH = (qrLength >> 8) & 0xFF;

        const CMD_QR_MODEL = new Uint8Array([GS, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);
        const CMD_QR_SIZE = new Uint8Array([GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x06]);
        const CMD_QR_ERROR = new Uint8Array([GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x44, 0x30]);
        const CMD_QR_STORE = new Uint8Array([GS, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30, ...qrData]);
        const CMD_QR_PRINT = new Uint8Array([GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]);

        let printPayload = [];

        printPayload.push(CMD_INIT);
        printPayload.push(CMD_CENTER, CMD_BOLD_ON, text(`====== ${tenantName.toUpperCase()} ======"`), CMD_BOLD_OFF);
        printPayload.push(text(`Hub.+${tenantPhone}`));
        printPayload.push(text("================================"));

        printPayload.push(CMD_LEFT);
        printPayload.push(text(`Tgl Masuk : ${formatTanggalIndo(currentOrderData.date)}`));
        printPayload.push(text(`Estimasi  : ${currentOrderData.estimatedPickup ? formatTanggalIndo(currentOrderData.estimatedPickup) : "-"}`));
        printPayload.push(text(`Invoice   : ${notaId}`));
        printPayload.push(text(`Kasir     : ${notaCashier}`));
       printPayload.push(text(`Customer  : ${notaCustomer}`));
        printPayload.push(text("--------------------------------"));

        if (currentOrderData.itemsDetail && currentOrderData.itemsDetail.length > 0) {
            currentOrderData.itemsDetail.forEach(it => {
                printPayload.push(CMD_LEFT, text(`${it.name}`));
                printPayload.push(CMD_RIGHT, text(`${it.qty}x @ Rp ${it.price.toLocaleString('id-ID')} -> Rp ${(it.price * it.qty).toLocaleString('id-ID')}`));
            });
        } else {
            printPayload.push(CMD_LEFT, text(currentOrderData.service || "Layanan Laundry"));
        }
        
        printPayload.push(CMD_LEFT, text("--------------------------------"));
        printPayload.push(text(`Pembayaran : ${notaPaymethod}`));
        printPayload.push(text(`Status     : ${notaPaymentStatus}`));
        printPayload.push(text(`Uang Bayar : Rp ${paidVal.toLocaleString('id-ID')}`));
        printPayload.push(text(`Kembalian  : Rp ${changeVal.toLocaleString('id-ID')}`));

        printPayload.push(CMD_BOLD_ON, CMD_RIGHT);
        printPayload.push(text(`TOTAL BILL : Rp ${notaTotal.toLocaleString('id-ID')}`));

        printPayload.push(CMD_BOLD_OFF);
        printPayload.push(CMD_CENTER, text("================================"));
        printPayload.push(text("Scan untuk cek status pesanan:"));
        printPayload.push(text("\n"));
        printPayload.push(CMD_QR_MODEL);
        printPayload.push(CMD_QR_SIZE);
        printPayload.push(CMD_QR_ERROR);
        printPayload.push(CMD_QR_STORE);
        printPayload.push(CMD_QR_PRINT);
        printPayload.push(text("\n"));

        printPayload.push(text("Pakaian Bersih, Wangi & Rapi"));
        printPayload.push(text("Terima Kasih :)"));
        printPayload.push(CMD_FEED);

        console.log('Mengirim data struk ke printer...');
        for (const chunk of printPayload) {
            await characteristic.writeValue(chunk);
        }

        alert('✅ Struk & QR Code berhasil dicetak via Bluetooth');
        server.disconnect();

    } catch (error) {
        console.error("Gagal cetak bluetooth:", error);
        alert('❌ Gagal print Bluetooth: ' + error.message);
    }
}

function updatePaymentStatus(orderId, newPaymentStatus) {
    const orderIndex = orders.findIndex(o => o.id === orderId);
    if (orderIndex !== -1) {
        orders[orderIndex].paymentStatus = newPaymentStatus;
        renderOrders();
        calculateFinance();
        
        if (SCRIPT_URL !== "" && !SCRIPT_URL.includes("SCRIPT_URL")) {
            fetch(SCRIPT_URL, { 
                method: 'POST', 
                mode: 'no-cors', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify({ 
                    action: "updatePaymentStatus", 
                    id: orderId, 
                    paymentStatus: newPaymentStatus 
                }) 
            }).catch(err => console.log("Gagal sinkron cloud:", err));
        }
        triggerNotification(`Status pembayaran nota ${orderId} diubah menjadi: ${newPaymentStatus}`);
    }
}

// ===============================================================
// FITUR PENGATURAN MULTI-TENANT & DASHBOARD KELOLA
// ===============================================================

function loadSettingsUI() {
    const urlInput = document.getElementById('setting-script-url');
    const nameInput = document.getElementById('setting-tenant-name');
    const phoneInput = document.getElementById('setting-tenant-phone');
    
    if(urlInput) urlInput.value = SCRIPT_URL;
    if(nameInput) nameInput.value = tenantName;
    if(phoneInput) phoneInput.value = tenantPhone;
}

function saveTenantSettings() {
    const urlInput = document.getElementById('setting-script-url').value.trim();
    const nameInput = document.getElementById('setting-tenant-name').value.trim();
    const phoneInput = document.getElementById('setting-tenant-phone').value.trim();

    // Simpan ke LocalStorage
    localStorage.setItem('tenant_script_url', urlInput);
    localStorage.setItem('tenant_name', nameInput);
    localStorage.setItem('tenant_phone', phoneInput);

    // FIX BUG 1: Langsung perbarui variabel global yang dipakai aplikasi
    SCRIPT_URL = urlInput;
    tenantName = nameInput;
    tenantPhone = phoneInput;

    triggerNotification("Pengaturan berhasil disimpan & database aktif diperbarui!");
    closeAllModals();
    updateTenantUI();
    
    // Opsional: Muat ulang data layanan & pesanan dari spreadsheet baru secara otomatis
    if (SCRIPT_URL) {
        fetchServicesAndOrders();
    }
}

function updateTenantUI() {
    document.querySelectorAll('.tenant-name-display').forEach(el => {
        el.innerText = tenantName;
    });
    const phoneNota = document.getElementById('nota-tenant-phone');
    if(phoneNota) {
        phoneNota.innerText = `Hub: +${tenantPhone}`;
    }
}

function downloadGSCode() {
    const gsCode = "Kalau mau kode GS, silakan order ke admin melalui link berikut:\nhttps://wa.me/6285659679645";
    const blob = new Blob([gsCode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a");
    downloadLink.href = url;
    downloadLink.download = "kodegs.txt";
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(url);
    triggerNotification("✅ File info order berhasil diunduh!");
}

// ===============================================================
// FITUR PENCATATAN & FILTER PENGELUARAN KEUANGAN
// ===============================================================

function toggleExpenseFilterInputs() {
    const mode = document.getElementById('expense-filter-mode').value;
    const wrapDate = document.getElementById('wrapper-expense-date');
    const wrapMonth = document.getElementById('wrapper-expense-month');

    wrapDate.classList.add('hidden');
    wrapMonth.classList.add('hidden');

    const now = new Date();
    const jktTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Jakarta"}));

    if (mode === 'date') {
        wrapDate.classList.remove('hidden');
        if(!document.getElementById('expense-input-date').value) {
            document.getElementById('expense-input-date').value = jktTime.toISOString().split('T')[0];
        }
    } else if (mode === 'month') {
        wrapMonth.classList.remove('hidden');
        if(!document.getElementById('expense-input-month').value) {
            const year = jktTime.getFullYear();
            const month = String(jktTime.getMonth() + 1).padStart(2, '0');
            document.getElementById('expense-input-month').value = `${year}-${month}`;
        }
    }
    calculateExpenses();
}

function calculateExpenses() {
    const mode = document.getElementById('expense-filter-mode') ? document.getElementById('expense-filter-mode').value : 'all';
    
    let filteredExpenses = [...expenses];
    let labelInfo = "Semua catatan pengeluaran";

    const now = new Date();
    const jktTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Jakarta"}));
    const todayStr = jktTime.toISOString().split('T')[0]; 

    if (mode === 'today') {
        filteredExpenses = expenses.filter(e => {
            if (!e.tanggal) return false;
            const expDateStr = new Date(e.tanggal).toISOString().split('T')[0];
            return expDateStr === todayStr;
        });
        labelInfo = `Pengeluaran Hari Ini`;
    } else if (mode === 'date') {
        const pickerDate = document.getElementById('expense-input-date').value;
        if (pickerDate) {
            filteredExpenses = expenses.filter(e => {
                if (!e.tanggal) return false;
                const expDateStr = new Date(e.tanggal).toISOString().split('T')[0];
                return expDateStr === pickerDate;
            });
            const d = new Date(pickerDate);
            labelInfo = `Tanggal: ${d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`;
        }
    } else if (mode === 'month') {
        const pickerMonth = document.getElementById('expense-input-month').value;
        if (pickerMonth) {
            filteredExpenses = expenses.filter(e => {
                if (!e.tanggal) return false;
                const expDateObj = new Date(e.tanggal);
                const expYear = expDateObj.getFullYear();
                const expMonth = String(expDateObj.getMonth() + 1).padStart(2, '0');
                return `${expYear}-${expMonth}` === pickerMonth;
            });
            const [year, month] = pickerMonth.split('-');
            const d = new Date(year, month - 1);
            labelInfo = `Bulan: ${d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}`;
        }
    }

    const totalOverall = filteredExpenses.reduce((sum, e) => sum + e.nominal, 0);
    const totalLaci = filteredExpenses.filter(e => e.sumber_dana === 'Kas Laci (Tunai)').reduce((sum, e) => sum + e.nominal, 0);
    const totalBank = filteredExpenses.filter(e => e.sumber_dana === 'Saldo Bank / QRIS').reduce((sum, e) => sum + e.nominal, 0);
    const totalOwner = filteredExpenses.filter(e => e.sumber_dana === 'Dana Pribadi (Owner)').reduce((sum, e) => sum + e.nominal, 0);

    if(document.getElementById('rep-expense-total')) document.getElementById('rep-expense-total').innerText = `Rp ${totalOverall.toLocaleString('id-ID')}`;
    if(document.getElementById('rep-expense-laci')) document.getElementById('rep-expense-laci').innerText = `Rp ${totalLaci.toLocaleString('id-ID')}`;
    if(document.getElementById('rep-expense-bank')) document.getElementById('rep-expense-bank').innerText = `Rp ${totalBank.toLocaleString('id-ID')}`;
    if(document.getElementById('rep-expense-owner')) document.getElementById('rep-expense-owner').innerText = `Rp ${totalOwner.toLocaleString('id-ID')}`;
    if(document.getElementById('expense-summary-label')) document.getElementById('expense-summary-label').innerText = labelInfo;

    renderExpenses(filteredExpenses);
}

function renderExpenses(dataToRender = expenses) {
    const logList = document.getElementById('expenses-log-list');
    if (!logList) return;

    if (isLoading) {
        logList.innerHTML = `
            <div class="bg-slate-200 rounded-xl h-14 mb-2 animate-pulse"></div>
            <div class="bg-slate-200 rounded-xl h-14 mb-2 animate-pulse"></div>
            <div class="bg-slate-200 rounded-xl h-14 animate-pulse"></div>
        `;
        return;
    }

    if (dataToRender.length === 0) {
        logList.innerHTML = `<p class="text-center italic text-slate-400 py-4 border border-slate-200 border-dashed rounded-xl mt-2">Data masih kosong. Belum ada catatan pengeluaran.</p>`;
        return;
    }

    logList.innerHTML = dataToRender.map(exp => {
        const dateObj = new Date(exp.tanggal);
        const dateStr = dateObj.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
        
        return `
        <div class="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100 mb-2">
            <div class="space-y-0.5">
                <p class="font-bold text-slate-700 text-xs line-clamp-1">${exp.keterangan}</p>
                <p class="text-[10px] text-slate-400 font-medium">${dateStr} • ${exp.sumber_dana}</p>
            </div>
            <div class="text-right">
                <p class="font-bold text-rose-500 text-xs">-Rp ${exp.nominal.toLocaleString('id-ID')}</p>
            </div>
        </div>`;
    }).join('');
}

function saveNewExpense() {
    const name = document.getElementById('expense-name').value.trim();
    const amount = parseFloat(document.getElementById('expense-amount').value);
    const source = document.getElementById('expense-source').value;

    if (!name || isNaN(amount)) return alert('Keterangan dan nominal pengeluaran wajib diisi!');

    const newExpense = {
        id: `EXP-${Math.floor(1000 + Math.random() * 9000)}`,
        tanggal: new Date().toISOString(),
        keterangan: name,
        nominal: amount,
        sumber_dana: source
    };

    expenses.unshift(newExpense); 
    calculateExpenses(); 

    if (SCRIPT_URL !== "" && !SCRIPT_URL.includes("SCRIPT_URL")) {
        const payloadToSend = { action: "addExpense", ...newExpense };
        fetch(SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payloadToSend)
        }).catch(err => console.log("Gagal mencatat pengeluaran ke cloud:", err));
    }

    document.getElementById('expense-name').value = '';
    document.getElementById('expense-amount').value = '';
    triggerNotification(`Pengeluaran "${name}" sukses dicatat!`);
}

function setDefaultDates() {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localNow = (new Date(now - tzOffset)).toISOString().slice(0,16);
    
    const inputOrder = document.getElementById('cart-order-date');
    if(inputOrder) inputOrder.value = localNow;

    const pickup = new Date(now.getTime() + (2 * 24 * 60 * 60 * 1000)); 
    const localPickup = (new Date(pickup - tzOffset)).toISOString().slice(0,16);
    const inputPickup = document.getElementById('cart-pickup-date');
    if(inputPickup) inputPickup.value = localPickup;
}

function formatTanggalIndo(dateStr) {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    const pad = (n) => n.toString().padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}