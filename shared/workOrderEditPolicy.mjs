export function isUnsignedOrderEditable(order) {
  return order?.status==='草稿'||Boolean(order?.status==='待客户签字'&&!order.paperOrder
    &&!order.signatures?.customer&&!order.customerSignatureFileId&&!order.signatureTokenUsed
    &&!order.customerSignatureReview);
}
