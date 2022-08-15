// The code snippet below is functional, but is made ugly on purpose
// Please refactor it to a state you'd be satisfied with and send back the refactored code

// Bonus challenge: there is a simple change that will improve database writes drastically
// Can you spot it?
const startCronJob = require("nugttah-backend/helpers/start.cron.job");
const Helpers = require("nugttah-backend/helpers");
const Invoice = require("nugttah-backend/modules/invoices");
const DirectOrder = require("nugttah-backend/modules/direct.orders");
const Part = require("nugttah-backend/modules/parts");
const DirectOrderPart = require("nugttah-backend/modules/direct.order.parts");

async function createInvoice() {
  /**
   * function description:
   * get all direct orders that are not invoiced and are not cancelled
   * for each direct order, get all direct order parts that are not invoiced and are not cancelled
   * for each direct order part, get the part and the quantity
   * for each part, create an invoice part with the quantity and the price
   * create an invoice with the invoice parts
   * update the direct order to invoiced
   * update the direct order parts to invoiced
   * return the invoice
   * @param () takes no parameters
   */

  try {
    // Get all direct orders that are not invoiced
    const dps = await DirectOrderPart.Model.find({
      createdAt: { $gt: new Date("2021-04-01") },
      fulfillmentCompletedAt: { $exists: true },
      invoiceId: { $exists: false },
    }).select("_id directOrderId partClass priceBeforeDiscount");

    // if there are no direct orders to invoice, throw an error
    if (!dps.length) {
      throw new Error("No direct order parts to invoice");
    }

    // find all parts that are in the direct orders
    const parts = await Part.Model.find({
      directOrderId: { $exists: true },
      createdAt: { $gt: new Date("2021-04-01") },
      partClass: "requestPart",
      pricedAt: { $exists: true },
      invoiceId: { $exists: false },
    }).select("_id directOrderId partClass premiumPriceBeforeDiscount");

    // if there are no parts to invoice, throw an error
    if (!parts.length) {
      throw new Error("No parts to invoice");
    }

    // concat the two arrays
    const allParts = parts.concat(dps);

    // group the parts by direct order id
    const directOrderPartsGroups = Helpers.groupBy(allParts, "directOrderId");

    // create an array of direct order ids
    const invcs = [];

    // for each direct order id
    for (let allDirectOrderParts of directOrderPartsGroups) {
      const directOrder = await DirectOrder.Model.findOne({
        _id: allDirectOrderParts[0].directOrderId,
      }).select(
        "partsIds requestPartsIds discountAmount deliveryFees walletPaymentAmount"
      );

      // if there is no direct order, throw an error
      if (!directOrder) {
        throw new Error("No direct order found");
      }

      // find the parts that are in the direct order
      const invoces = await Invoice.Model.find({
        directOrderId: allDirectOrderParts[0].directOrderId,
      }).select("walletPaymentAmount discountAmount deliveryFees");

      // if there are no invoices, throw an error
      if (!invoces.length) {
        throw new Error("No invoices found");
      }

      // filter the parts that are in the direct order
      const directOrderParts = allDirectOrderParts.filter(
        (directOrderPart) =>
          directOrderPart.partClass === "StockPart" ||
          directOrderPart.partClass === "QuotaPart"
      );

      // filter the request parts that are in the direct order with partClass === "requestPart"
      const requestParts = allDirectOrderParts.filter(
        (part) => part.partClass === "requestPart"
      );

      // sum the parts that are in the direct order for priceBeforeDiscount
      const dpsprice = directOrderParts.reduce(
        (sum, part) => sum + part.priceBeforeDiscount,
        0
      );

      // sum the request parts that are in the direct order for premiumPriceBeforeDiscount
      const rpsprice = requestParts.reduce(
        (sum, part) => sum + part.premiumPriceBeforeDiscount,
        0
      );

      // map the directOrderParts to an array of part ids ==> [] of part ids
      const directOrderPartsIds = directOrderParts.map((part) => part._id);

      // map the requestParts to an array of part ids ==> [] of part ids
      const requestPartsIds = requestParts.map((part) => part._id);

      // sum the rpsprice and dpsprice
      const TotalPrice = Helpers.Numbers.toFixedNumber(rpsprice + dpsprice);

      // extract the deliveryFees from the directOrder
      const { deliveryFees } = directOrder;

      // extract the walletPaymentAmount and discountAmount from the directOrder
      let { walletPaymentAmount, discountAmount } = directOrder;

      // set totalAmount to be the total price of the parts
      let totalAmount = TotalPrice;

      // if dirercOrder has a deliveryFees, and there is no invoces.length, make the totalAmount equal to the total price of the parts + the deliveryFees
      if (directOrder.deliveryFees && invoces.length === 0) {
        totalAmount += directOrder.deliveryFees;
      }

      // if there is a walletPaymentAmount, loop throw invoces and add the walletPaymentAmount to the min of zero or walletpaymentamount - invoce.walletPaymentAmount
      if (walletPaymentAmount) {
        invoces.forEach((invo) => {
          walletPaymentAmount = Math.min(
            0,
            walletPaymentAmount - invo.walletPaymentAmount
          );
        });
        walletPaymentAmount = Math.min(walletPaymentAmount, totalAmount);

        // totalAmount = totalAmount - walletPaymentAmount;
        totalAmount -= walletPaymentAmount;
      }

      // if there is a discountAmount, loop throw invoces and add the discountAmount to the min of zero or discountAmount - invoce.discountAmount
      if (discountAmount) {
        invoces.forEach((nvc) => {
          discountAmount = Math.min(0, discountAmount - nvc.discountAmount);
        });
        discountAmount = Math.min(discountAmount, totalAmount);

        // totalAmount = totalAmount - discountAmount;
        totalAmount -= discountAmount;
      }

      // if the totalAmount is less than zero, throw an error
      if (totalAmount < 0) {
        throw Error(
          `Could not create invoice for directOrder: ${directOrder._id} with totalAmount: ${totalAmount}. `
        );
      }

      // create an invoice
      const invoice = await Invoice.Model.insertOne({
        directOrderId: directOrder._id,
        totalPartsAmount: TotalPrice,
        directOrderPartsIds,
        requestPartsIds,
        totalAmount,
        deliveryFees,
        walletPaymentAmount,
        discountAmount,
      });

      // add distinct invoice id to DirectOrder.invoiceId
      await DirectOrder.Model.updateOne(
        { _id: directOrder._id },
        { $addToSet: { invoicesIds: invoice._id } }
      );

      // loop throw directOrderPartsIds and update DirectorderPart.invoiceId
      for (let directPartId of directOrderPartsIds) {
        await DirectOrderPart.Model.updateOne(
          { _id: directPartId },
          { invoiceId: invoice._id }
        );
      }

      // wait for updates before pushing to invoices array
      requestParts.map((requestId) => {
        return new Promise((resolve, reject) => {
          Part.Model.updateOne({ _id: requestId }, { invoiceId: invoice._id })
            .then(function (result) {
              return resolve();
            })
            .catch(() => {
              reject();
            });
        });
      });

      invcs.push(invoice._id);
    }

    // on success, return the invoices array with message and case 1
    return {
      case: 1,
      message: "invoices created successfully.",
      invoicesIds: invcs,
    };
  } catch (err) {
    // on error, return the reportError with the err that occured if any async operation fails
    Helpers.reportError(err);
  }
}

// cron job to create invoices for all direct orders that are not invoiced
startCronJob("*/1 * * * *", createInvoice, true); // at 00:00 every day

module.exports = createInvoice;
