-- Example specification for the tiny network in model.onnx.
-- The network computes y = relu(x0 + x1) + relu(x0 - x1),
-- so on inputs in [0, 1] its output is at most 2.

@network
f : Tensor Real [2] -> Tensor Real [1]

validInput : Tensor Real [2] -> Bool
validInput x = forall i . 0 <= x ! i <= 1

-- True: the output never exceeds 2.5.
@property
belowTwoAndAHalf : Bool
belowTwoAndAHalf = forall x . validInput x => f x ! 0 <= 2.5

-- False: inputs near x0 = 1 give outputs above 1.5.
@property
belowOneAndAHalf : Bool
belowOneAndAHalf = forall x . validInput x => f x ! 0 <= 1.5
