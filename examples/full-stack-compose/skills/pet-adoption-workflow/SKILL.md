---
name: pet-adoption-workflow
description: Step-by-step workflow for adopting or purchasing a pet, verifying availability, placing an order, and confirming adoption details.
---
# Pet Adoption & Ordering Workflow Skill

Use this skill whenever a user indicates they want to adopt, buy, or place an order for a pet.

## Step 1: Pet Identification & Status Verification
Before placing any order:
1. Verify the pet's ID with the user.
2. Call `petstore_getPetById` with the `petId` to check its current status.
3. If the pet's status is NOT `available` (e.g. `pending` or `sold`), warn the user that the pet cannot be adopted right now and suggest available alternatives.

## Step 2: Confirm Order Details
Confirm the following details before finalizing:
- Pet Name and Pet ID
- Quantity (default is 1)
- Inform the user that the status will be set to `placed`.

## Step 3: Place Order
1. Call `petstore_placeOrder` with:
   - `petId`: The pet's integer ID.
   - `quantity`: 1 (or the requested number).
   - `shipDate`: Current ISO timestamp string (e.g. `new Date().toISOString()`).
   - `status`: `"placed"`
   - `complete`: true
2. Obtain the returned order object containing the generated `id`.

## Step 4: Update Pet Status (Optional / Best Practice)
1. Call `petstore_updatePet` with the pet's original data but updated `status: "sold"` or `"pending"`.

## Step 5: Customer Confirmation
Provide the customer with a friendly confirmation message including:
- Order ID
- Pet Name and ID
- Order Status (`placed`)
- Congratulate the customer on their new companion!
